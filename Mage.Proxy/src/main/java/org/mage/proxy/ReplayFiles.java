package org.mage.proxy;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.java_websocket.WebSocket;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.logging.Logger;

/**
 * {@code getReplayFiles} — list the saved replay files present in the proxy's replay directory
 * ({@code --replayDir}, default {@code saved}, resolved against the proxy process CWD exactly
 * like {@code GameReplay.loadGame} resolves against the SERVER's CWD).
 *
 * <p>Frozen contract:
 * <pre>
 * {"action":"getReplayFiles","requestId":…,"args":{}} →
 *   {"type":"result","action":"getReplayFiles","requestId":…,"ok":true,
 *    "data":{"directory":&lt;ABS path&gt;,"exists":&lt;bool&gt;,
 *            "files":[{"gameId","bytes","savedAtMs","meta"?}]}}
 * </pre>
 * Sorted by {@code gameId} ascending. This reads the PROXY filesystem (not the server), so it is
 * stock-server-compatible and carries NO capability gate (the fork-only part stays on the
 * {@code replayGame}/{@code startReplay}/{@code seek} verbs).
 *
 * <ul>
 *   <li>A non-UUID {@code *.game} name is SKIPPED with a warning: the desktop client only accepts
 *       {@code <uuid>.game} (replayInit takes a UUID), so listing it would offer a guaranteed
 *       failure.</li>
 *   <li>A missing directory is NOT an error: {@code exists:false}, empty list, WARN log naming the
 *       absolute path.</li>
 *   <li>{@code meta} is the parsed {@code <uuid>.json} sidecar object VERBATIM; the key is ABSENT
 *       when there is no sidecar or it is unreadable — an unreadable sidecar must NOT remove a
 *       loadable row (it just degrades to a legacy row).</li>
 * </ul>
 */
final class ReplayFiles {

    private static final Logger logger = Logger.getLogger(ReplayFiles.class.getName());

    private ReplayFiles() {
    }

    static boolean handle(String action, WebSocket conn, String requestId, JsonObject args, CommandContext ctx) {
        if (!"getReplayFiles".equals(action)) {
            return false;
        }
        String dir = ctx.gateway().getConfig().getReplayDir();
        ctx.gateway().send(conn, ProxyProtocol.resultJson(action, requestId, true, null, listing(dir)));
        return true;
    }

    /**
     * Builds the {@code data} object for the listing: the absolute directory path, whether it
     * exists, and the sorted file rows. Split out so it can be unit-tested without a WebSocket.
     */
    static JsonObject listing(String dirPath) {
        File dir = new File(dirPath);
        JsonObject data = new JsonObject();
        data.addProperty("directory", dir.getAbsolutePath());
        List<JsonObject> rows = new ArrayList<>();
        boolean exists = dir.isDirectory();
        data.addProperty("exists", exists);
        if (exists) {
            File[] files = dir.listFiles((d, name) -> name.endsWith(".game"));
            if (files != null) {
                for (File f : files) {
                    String name = f.getName();
                    String gameId = name.substring(0, name.length() - ".game".length());
                    try {
                        UUID.fromString(gameId);
                    } catch (IllegalArgumentException ex) {
                        // The desktop client only accepts <uuid>.game: a file named otherwise can
                        // never be loaded (replayInit takes a UUID), so listing it would offer a
                        // guaranteed failure.
                        logger.warning("Skipping non-UUID replay file: " + sanitizeForLog(name));
                        continue;
                    }
                    JsonObject row = new JsonObject();
                    row.addProperty("gameId", gameId);
                    row.addProperty("bytes", f.length());
                    row.addProperty("savedAtMs", f.lastModified());
                    JsonObject meta = readMeta(dir, gameId);
                    if (meta != null) {
                        row.add("meta", meta);
                    }
                    rows.add(row);
                }
            }
            rows.sort(Comparator.comparing(o -> o.get("gameId").getAsString()));
        } else {
            logger.warning("Replay directory '" + dir.getAbsolutePath() + "' does not exist —"
                    + " returning an empty replay list (is the proxy's working directory the"
                    + " server's? override with --replayDir)");
        }
        com.google.gson.JsonArray arr = new com.google.gson.JsonArray();
        for (JsonObject row : rows) {
            arr.add(row);
        }
        data.add("files", arr);
        return data;
    }

    /**
     * The parsed {@code <uuid>.json} sidecar as a JSON object, or {@code null} when there is no
     * sidecar, it is unreadable, or it is not a JSON object. A torn/corrupt sidecar degrades the
     * row to legacy display; it must never remove a loadable replay from the listing.
     */
    private static JsonObject readMeta(File dir, String gameId) {
        File sidecar = new File(dir, gameId + ".json");
        if (!sidecar.isFile()) {
            return null;
        }
        try {
            String body = new String(Files.readAllBytes(sidecar.toPath()), StandardCharsets.UTF_8);
            JsonElement parsed = JsonParser.parseString(body);
            if (parsed != null && parsed.isJsonObject()) {
                return parsed.getAsJsonObject();
            }
            logger.warning("Replay sidecar is not a JSON object for " + sanitizeForLog(gameId));
        } catch (Exception ex) {
            logger.warning("Replay sidecar unreadable for " + sanitizeForLog(gameId) + ": " + ex.getMessage());
        }
        return null;
    }

    /** Strips CR/LF so a crafted file name cannot forge log lines. */
    static String sanitizeForLog(String name) {
        return name == null ? "" : name.replaceAll("[\\r\\n]+", " ");
    }

    /** Test seam: the sorted file ids of a listing, for assertions. */
    static List<String> gameIds(JsonObject listing) {
        List<String> out = new ArrayList<>();
        if (listing.has("files") && listing.get("files").isJsonArray()) {
            for (JsonElement e : listing.getAsJsonArray("files")) {
                out.add(e.getAsJsonObject().get("gameId").getAsString());
            }
        }
        return out;
    }
}
