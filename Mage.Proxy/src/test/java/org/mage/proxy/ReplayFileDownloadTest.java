package org.mage.proxy;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link ReplayFileDownload} — UUID allowlist, traversal
 * attempt, absent dir, non-UUID name, missing file, plus the live route contract
 * (headers, byte-identical body, 404/405).
 */
class ReplayFileDownloadTest {

    @TempDir
    Path dir;

    @TempDir
    Path outside;

    private HttpServer server;
    private HttpClient client;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(ReplayFileDownload.ROUTE_PREFIX, new ReplayFileDownload(dir.toString()));
        server.start();
        client = HttpClient.newHttpClient();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private String base() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private HttpResponse<byte[]> get(String path) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(base() + path)).GET().build();
        return client.send(request, HttpResponse.BodyHandlers.ofByteArray());
    }

    private Path save(String gameId, byte[] body) throws IOException {
        Path file = dir.resolve(gameId + ReplayFileDownload.NAME_SUFFIX);
        Files.write(file, body);
        return file;
    }

    @Test
    void servesTheFileBytesWithTheDownloadContract() throws Exception {
        String gameId = UUID.randomUUID().toString();
        byte[] body = "replay-bytes-0123456789".getBytes(StandardCharsets.UTF_8);
        save(gameId, body);

        HttpResponse<byte[]> res = get(ReplayFileDownload.ROUTE_PREFIX + gameId + ReplayFileDownload.NAME_SUFFIX);
        assertEquals(200, res.statusCode());
        assertEquals("application/octet-stream", res.headers().firstValue("Content-Type").orElse(""));
        assertEquals("attachment; filename=\"" + gameId + ReplayFileDownload.NAME_SUFFIX + "\"",
                res.headers().firstValue("Content-Disposition").orElse(""));
        assertEquals((long) body.length, Long.parseLong(res.headers().firstValue("Content-Length").orElse("0")));
        assertEquals("no-store", res.headers().firstValue("Cache-Control").orElse(""));
        assertTrue(java.util.Arrays.equals(body, res.body()));
    }

    @Test
    void rejectsNonUuidNamesTraversalMissingFileAndNonGet() throws Exception {
        String gameId = UUID.randomUUID().toString();
        save(gameId, "x".getBytes(StandardCharsets.UTF_8));

        // Non-UUID stem (the listing skips these for the same reason).
        assertEquals(404, get(ReplayFileDownload.ROUTE_PREFIX + "not-a-uuid.game").statusCode());
        // Missing file with a valid shape.
        assertEquals(404, get(ReplayFileDownload.ROUTE_PREFIX + "00000000-0000-0000-0000-000000000000.game").statusCode());
        // Traversal attempts never resolve to a file: the stem keeps its strict shape or is refused.
        assertEquals(404, get(ReplayFileDownload.ROUTE_PREFIX + "../../../../etc/passwd").statusCode());
        assertEquals(404, get(ReplayFileDownload.ROUTE_PREFIX + gameId + ".game/../other.game").statusCode());
        // Bare id without the .game suffix: refused (the stem IS the allowlist).
        assertEquals(404, get(ReplayFileDownload.ROUTE_PREFIX + gameId).statusCode());
        // POST on a GET-only route.
        HttpRequest post = HttpRequest.newBuilder(URI.create(base() + ReplayFileDownload.ROUTE_PREFIX + gameId + ReplayFileDownload.NAME_SUFFIX)).POST(HttpRequest.BodyPublishers.noBody()).build();
        assertEquals(405, client.send(post, HttpResponse.BodyHandlers.discarding()).statusCode());
    }

    @Test
    void servesNothingWhenTheDirectoryIsMissing() throws Exception {
        HttpResponse<byte[]> res = get(ReplayFileDownload.ROUTE_PREFIX + UUID.randomUUID() + ReplayFileDownload.NAME_SUFFIX);
        assertEquals(404, res.statusCode());
    }

    @Test
    void resolveEnforcesAllowlistAndExistence() throws Exception {
        String gameId = UUID.randomUUID().toString();
        save(gameId, "z".getBytes(StandardCharsets.UTF_8));

        assertTrue(ReplayFileDownload.resolve(dir.toString(), gameId).isFile());
        // The suffix never reaches resolve: a stem carrying ".game" is not one.
        assertNull(ReplayFileDownload.resolve(dir.toString(), gameId + ReplayFileDownload.NAME_SUFFIX));
        assertNull(ReplayFileDownload.resolve(dir.toString(), "traversal-36-chars-not-a-uuid!"));
        assertNull(ReplayFileDownload.resolve(dir.toString(), null));
        // Only hex/dash allowed — the shape rejects letters outside the hex range.
        assertFalse(ReplayFileDownload.STEM_PATTERN.matcher("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz").matches());
        // Absent directory / absent file.
        assertNull(ReplayFileDownload.resolve(dir.resolve("no-such-dir").toString(), gameId));
        assertNull(ReplayFileDownload.resolve(dir.toString(), UUID.randomUUID().toString()));
    }

    @Test
    void containmentRefusesAPerFileSymlinkEscapeButKeepsASymlinkedReplayDir() throws Exception {
        String gameId = UUID.randomUUID().toString();
        save(gameId, "z".getBytes(StandardCharsets.UTF_8));
        Path victim = outside.resolve("victim.txt");
        Files.writeString(victim, "secret");

        String escapeId = UUID.randomUUID().toString();
        boolean escapeLinked = false;
        try {
            Files.createSymbolicLink(dir.resolve(escapeId + ReplayFileDownload.NAME_SUFFIX), victim);
            escapeLinked = true;
        } catch (UnsupportedOperationException | IOException noSymlinks) {
            // Filesystem without symlink support: nothing symlink-specific to prove.
        }
        if (escapeLinked) {
            assertNull(ReplayFileDownload.resolve(dir.toString(), escapeId));
        }

        // A symlinked replay DIRECTORY still serves its real content (the rig's
        // server/proxy sharing convention is exactly that); containment is judged
        // against the canonical dir, not the caller-supplied one.
        Path linked = Files.createTempDirectory("replay-download-linked");
        Files.deleteIfExists(linked);
        boolean dirLinked = false;
        try {
            Files.createSymbolicLink(linked, dir);
            dirLinked = true;
        } catch (UnsupportedOperationException | IOException noSymlinks) {
            // no symlink support: only the canonical-dir cases above apply
        }
        if (dirLinked) {
            try {
                assertTrue(ReplayFileDownload.resolve(linked.toString(), gameId).isFile());
            } finally {
                Files.deleteIfExists(linked);
            }
        }
    }
}