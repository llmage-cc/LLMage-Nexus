package org.mage.proxy;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import mage.game.match.MatchOptions;
import mage.game.tournament.TournamentOptions;
import mage.players.PlayerType;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * No live LLM reasoning tab in-game: the LLM drawer tab is
 * offered to a spectator only when the match is marked {@code llmChatPublic}.
 * The one-click "LLM vs LLM" preset makes the creator a SPECTATOR
 * of an all-bot table, so that table must be public or the tab is unreachable by
 * design. The proxy derives the flag from the seat shape when the web omits it.
 *
 * <p>{@code MatchOptions.llmChatPublic} defaulted false with no web flag, so the
 * all-LLM duel stayed private; {@link MatchOptionsParser#resolveLlmChatPublic}
 * derives it from the seat shape.
 */
class MatchOptionsLlmChatPublicTest {

    private static JsonObject args(String... seats) {
        JsonObject args = new JsonObject();
        args.addProperty("name", "T");
        JsonArray types = new JsonArray();
        for (String seat : seats) {
            types.add(seat);
        }
        args.add("playerTypes", types);
        return args;
    }

    @Test
    void allLlmDuelIsMarkedPublicSoTheCreatorCanWatchIt() {
        MatchOptions options = MatchOptionsParser.parseMatchOptions(args("COMPUTER_LLM", "COMPUTER_LLM"));
        assertTrue(options.isLlmChatPublic());
    }

    @Test
    void humanVsLlmStaysPrivate() {
        MatchOptions options = MatchOptionsParser.parseMatchOptions(args("HUMAN", "COMPUTER_LLM"));
        assertFalse(options.isLlmChatPublic());
    }

    @Test
    void allHumanStaysPrivate() {
        MatchOptions options = MatchOptionsParser.parseMatchOptions(args("HUMAN", "HUMAN"));
        assertFalse(options.isLlmChatPublic());
    }

    @Test
    void llmPlusSimSeatStaysPrivateBecauseSimIsAServerSideHumanSeat() {
        // SIM is materialised as HUMAN for the server (see SimPlayerTest); the
        // conservative rule keeps any human-looking seat private. This mixed
        // manual config is not the all-LLM preset.
        MatchOptions options = MatchOptionsParser.parseMatchOptions(args("COMPUTER_LLM", "SIM"));
        assertFalse(options.isLlmChatPublic());
    }

    @Test
    void explicitClientFlagWinsOverTheSeatDerivation() {
        JsonObject forcePublic = args("HUMAN", "COMPUTER_LLM");
        forcePublic.addProperty("llmChatPublic", true);
        assertTrue(MatchOptionsParser.parseMatchOptions(forcePublic).isLlmChatPublic());

        JsonObject forcePrivate = args("COMPUTER_LLM", "COMPUTER_LLM");
        forcePrivate.addProperty("llmChatPublic", false);
        assertFalse(MatchOptionsParser.parseMatchOptions(forcePrivate).isLlmChatPublic());
    }

    @Test
    void tournamentAllLlmMatchIsMarkedPublic() {
        JsonObject args = args("COMPUTER_LLM", "COMPUTER_LLM");
        args.addProperty("tournamentType", "Elimination");
        TournamentOptions tOpts = MatchOptionsParser.parseTournamentOptions(args);
        assertTrue(tOpts.getMatchOptions().isLlmChatPublic());
    }

    @Test
    void tournamentWithAHumanSeatStaysPrivate() {
        JsonObject args = args("HUMAN", "COMPUTER_LLM");
        args.addProperty("tournamentType", "Elimination");
        TournamentOptions tOpts = MatchOptionsParser.parseTournamentOptions(args);
        assertFalse(tOpts.getMatchOptions().isLlmChatPublic());
    }
}
