package org.mage.proxy;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.regex.Pattern;

/**
 * {@code GET /replay-file/<uuid>.game} — download a saved replay's BYTES. It serves like the
 * listing does — no additional gate; the deployment's own access control is what
 * gates who reaches the proxy at all, and {@code getReplayFiles} already hands
 * the same game ids to the same clients).
 *
 * <p>An HTTP route, not a WS verb, on purpose: saves can be large (a 100+ turn
 * save needed 2+ GB of heap just to LOAD), and a streaming download keeps the
 * bytes out of the browser's JS heap while the browser shows its own progress.
 * The web clicks it with a plain {@code <a href download>} navigation.
 *
 * <p>Hardening (never a caller-supplied path):
 * <ul>
 *   <li>the name must be exactly {@code <uuid>.game} where {@code <uuid>} is
 *       36 hexadecimal/dash characters — the SAME shape the {@code
 *       getReplayFiles} listing enforces when it skips non-UUID files;</li>
 *   <li>the file is resolved under the canonical {@code --replayDir} and the
 *       canonical result must stay INSIDE it — a symlinked individual file that
 *       points outside the directory is refused, while a symlinked replay DIR
 *       (the rig's server/proxy sharing convention) keeps working;</li>
 *   <li>anything else — non-GET, bad name, traversal attempt, escape, absent
 *       file, missing directory — is a {@code 404} (405 for non-GET).</li>
 * </ul>
 */
final class ReplayFileDownload implements HttpHandler {

    /** The listing's UUID shape: 36 hexadecimal digits / dashes. */
    static final Pattern STEM_PATTERN = Pattern.compile("^[0-9a-fA-F-]{36}$");

    /** The route path's required suffix (also the served file's extension). */
    static final String NAME_SUFFIX = ".game";

    static final String ROUTE_PREFIX = "/replay-file/";

    private final String replayDir;

    ReplayFileDownload(String replayDir) {
        this.replayDir = (replayDir == null || replayDir.trim().isEmpty())
                ? Config.DEFAULT_REPLAY_DIR
                : replayDir.trim();
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        try {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(405, -1);
                return;
            }
            String path = exchange.getRequestURI().getPath();
            String name = path != null && path.startsWith(ROUTE_PREFIX)
                    ? path.substring(ROUTE_PREFIX.length())
                    : "";
            String stem = name.endsWith(NAME_SUFFIX)
                    ? name.substring(0, name.length() - NAME_SUFFIX.length())
                    : null;
            File file = stem == null ? null : resolve(replayDir, stem);
            if (file == null) {
                exchange.sendResponseHeaders(404, -1);
                return;
            }
            exchange.getResponseHeaders().add("Content-Type", "application/octet-stream");
            exchange.getResponseHeaders().add("Content-Disposition",
                    "attachment; filename=\"" + stem + NAME_SUFFIX + "\"");
            exchange.getResponseHeaders().add("Cache-Control", "no-store");
            exchange.sendResponseHeaders(200, file.length());
            try (OutputStream os = exchange.getResponseBody()) {
                Files.copy(file.toPath(), os);
            }
        } catch (Exception other) {
            try {
                exchange.sendResponseHeaders(500, -1);
            } catch (IOException ignored) {
            }
        } finally {
            exchange.close();
        }
    }

    /**
     * The file this request may download, or null. Split out so the allowlist +
     * containment rules are unit-testable without an HTTP server.
     */
    static File resolve(String replayDir, String stem) throws IOException {
        if (stem == null || !STEM_PATTERN.matcher(stem).matches()) {
            return null;
        }
        File dir = new File(replayDir).getCanonicalFile();
        if (!dir.isDirectory()) {
            return null;
        }
        File file = new File(dir, stem + NAME_SUFFIX).getCanonicalFile();
        // Canonical containment: the strict name rules out traversal by itself,
        // this additionally refuses a per-file symlink that escapes the directory.
        if (!file.getPath().startsWith(dir.getPath() + File.separator)) {
            return null;
        }
        return file.isFile() ? file : null;
    }
}