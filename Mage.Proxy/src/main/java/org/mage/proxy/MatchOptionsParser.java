package org.mage.proxy;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import mage.game.match.MatchOptions;
import mage.players.LLMPlayerConfig;
import mage.players.PlayerType;

import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Construcción de MatchOptions/TournamentOptions desde args JSON. */
final class MatchOptionsParser {

    private MatchOptionsParser() {
    }

    static MatchOptions parseMatchOptions(JsonObject args) {
        return parseMatchOptions(args, Config.parseHostSet(Config.DEFAULT_ALLOWED_MODEL_HOSTS));
    }

    /**
     * {@code allowedModelHosts}: the model-endpoint allowlist the seat {@code apiEndpoint}s must
     * pass (the proxy CLI's {@code --allowedModelHosts}). Violations throw
     * {@link IllegalArgumentException}; the command handlers answer typed
     * {@code ok:false, errorCode:"INVALID_ARGUMENT"}.
     */
    static MatchOptions parseMatchOptions(JsonObject args, Set<String> allowedModelHosts) {
        String name = JsonArgs.str(args, "name", "Game " + System.currentTimeMillis());
        String gameType = JsonArgs.str(args, "gameType", "");
        boolean multiPlayer = JsonArgs.getBool(args, "multiPlayer", false);
        MatchOptions options = new MatchOptions(name, gameType, multiPlayer);
        applyMatchOptions(args, options);
        if (args.has("freeMulligans")) {
            options.setFreeMulligans(JsonArgs.getInt(args, "freeMulligans", 0));
        }
        if (args.has("attackOption")) {
            try {
                options.setAttackOption(mage.constants.MultiplayerAttackOption.valueOf(JsonArgs.str(args, "attackOption", "LEFT").toUpperCase(Locale.ROOT)));
            } catch (Exception ignored) {
            }
        }
        if (args.has("range")) {
            try {
                options.setRange(mage.constants.RangeOfInfluence.valueOf(JsonArgs.str(args, "range", "ALL").toUpperCase(Locale.ROOT)));
            } catch (Exception ignored) {
            }
        }
        if (args.has("minimumRating")) {
            options.setMinimumRating(JsonArgs.getInt(args, "minimumRating", 0));
        }
        if (args.has("edhPowerLevel")) {
            options.setEdhPowerLevel(JsonArgs.getInt(args, "edhPowerLevel", 100));
        }
        if (args.has("mulliganType")) {
            try {
                options.setMullgianType(mage.game.mulligan.MulliganType.valueOf(JsonArgs.str(args, "mulliganType", "GAME_DEFAULT").toUpperCase(Locale.ROOT)));
            } catch (Exception ignored) {
            }
        }
        if (args.has("customStartLifeEnabled")) {
            options.setCustomStartLifeEnabled(JsonArgs.getBool(args, "customStartLifeEnabled", false));
            if (args.has("customStartLife")) options.setCustomStartLife(JsonArgs.getInt(args, "customStartLife", 20));
        }
        if (args.has("customStartHandSizeEnabled")) {
            options.setCustomStartHandSizeEnabled(JsonArgs.getBool(args, "customStartHandSizeEnabled", false));
            if (args.has("customStartHandSize")) options.setCustomStartHandSize(JsonArgs.getInt(args, "customStartHandSize", 7));
        }
        if (args.has("planeChase")) {
            options.setPlaneChase(JsonArgs.getBool(args, "planeChase", false));
        }
        // modo test: no barajar el mazo inicial (la librería queda en el orden
        // enviado); los servidores sin modificar ignoran el campo
        options.setSkipInitShuffling(JsonArgs.getBool(args, "skipInitShuffling", false));
        // modo test: sin sorteo aleatorio de starting player (el primer jugador de
        // la mesa empieza); los servidores sin modificar ignoran el campo
        options.setSkipStartingPlayerChoice(JsonArgs.getBool(args, "skipStartingPlayerChoice", false));
        options.getPlayerTypes().add(PlayerType.HUMAN);
        if (args.has("playerTypes")) {
            JsonArray arr = args.getAsJsonArray("playerTypes");
            List<PlayerType> types = new java.util.ArrayList<>();
            for (JsonElement e : arr) {
                String raw = e.getAsString();
                if ("SIM".equalsIgnoreCase(raw)) {
                    // asiento simulado: el servidor oficial ve un asiento humano normal
                    types.add(PlayerType.HUMAN);
                } else {
                    types.add(PlayerType.valueOf(raw.toUpperCase(Locale.ROOT)));
                }
            }
            if (!types.isEmpty()) {
                options.getPlayerTypes().clear();
                options.getPlayerTypes().addAll(types);
            }
        }
        // One optional llmConfigs entry per COMPUTER_LLM seat, consumed positionally
        // by the server (TableController.wireLlmConfigs). null entries mean server defaults.
        List<LLMPlayerConfig> llmConfigs = LlmConfigs.parse(args, options.getPlayerTypes(), allowedModelHosts);
        if (!llmConfigs.isEmpty()) {
            options.setLlmPlayerConfigs(llmConfigs);
        }
        options.setLlmChatPublic(resolveLlmChatPublic(args, options.getPlayerTypes()));
        return options;
    }

    /**
     * Fork (LLMage): decide the match's {@code llmChatPublic} flag for a MATCH request.
     *
     * <p>The webui's LLM drawer tab is offered to a spectator only when the table is
     * marked {@code llmChatPublic}. But the one-click "LLM vs LLM" preset
     * creates an all-bot table exactly so the human can WATCH it (the creator holds no
     * seat, {@code humanSeat=false}), and the web never sends this flag — so without this
     * default every preset table is private and its LLM tab is unreachable by design.
     *
     * <p>Rule: a table with LLM seats and NO HUMAN seat is a public showcase — mark it
     * public. Any table with a HUMAN seat keeps the private (per-seat) default, so an
     * opponent still cannot read a human's LLM reasoning mid-game.
     *
     * <p>An explicit client {@code llmChatPublic} always wins (forward-compat: a client
     * whose table setup exposes the checkbox can send it); today the webui omits it.
     */
    static boolean resolveLlmChatPublic(JsonObject args, List<PlayerType> playerTypes) {
        if (args.has("llmChatPublic") && args.get("llmChatPublic").isJsonPrimitive()) {
            return args.get("llmChatPublic").getAsBoolean();
        }
        boolean hasLlmSeat = playerTypes != null && playerTypes.contains(PlayerType.COMPUTER_LLM);
        boolean hasHumanSeat = playerTypes != null && playerTypes.contains(PlayerType.HUMAN);
        return hasLlmSeat && !hasHumanSeat;
    }

    /** True when the requested seat list contains the dev-only "SIM" bot seat. */
    static boolean hasSimSeat(JsonObject args) {
        if (!args.has("playerTypes") || !args.get("playerTypes").isJsonArray()) {
            return false;
        }
        for (JsonElement e : args.getAsJsonArray("playerTypes")) {
            if (e.isJsonPrimitive() && "SIM".equalsIgnoreCase(e.getAsString())) {
                return true;
            }
        }
        return false;
    }

    /** Campos de MatchOptions compartidos por mesa y torneo. */
    static void applyMatchOptions(JsonObject args, MatchOptions options) {
        options.setDeckType(JsonArgs.str(args, "deckType", ""));
        options.setLimited(JsonArgs.getBool(args, "limited", false));
        options.setWinsNeeded(JsonArgs.getInt(args, "winsNeeded", 1));
        // default high value, so any user can create tables (real client lets the owner pick it)
        options.setQuitRatio(JsonArgs.getInt(args, "quitRatio", 100));
        options.setPassword(JsonArgs.str(args, "password", ""));
        options.setSpectatorsAllowed(JsonArgs.getBool(args, "spectatorsAllowed", true));
        if (args.has("rollbackTurnsAllowed")) {
            options.setRollbackTurnsAllowed(JsonArgs.getBool(args, "rollbackTurnsAllowed", true));
        }
        if (args.has("rated")) {
            options.setRated(JsonArgs.getBool(args, "rated", false));
        }
        if (args.has("skillLevel")) {
            try {
                options.setSkillLevel(mage.constants.SkillLevel.valueOf(JsonArgs.str(args, "skillLevel", "CASUAL").toUpperCase(Locale.ROOT)));
            } catch (Exception ignored) {
            }
        }
        if (args.has("timeLimit")) {
            try {
                options.setMatchTimeLimit(mage.constants.MatchTimeLimit.valueOf(JsonArgs.str(args, "timeLimit", "NONE").toUpperCase(Locale.ROOT)));
            } catch (Exception ignored) {
            }
        }
        if (args.has("bufferTime")) {
            try {
                options.setMatchBufferTime(mage.constants.MatchBufferTime.valueOf(JsonArgs.str(args, "bufferTime", "NONE").toUpperCase(Locale.ROOT)));
            } catch (Exception ignored) {
            }
        }
        if (args.has("bannedUsers") && args.get("bannedUsers").isJsonArray()) {
            java.util.Set<String> banned = new java.util.HashSet<>();
            for (JsonElement e : args.getAsJsonArray("bannedUsers")) banned.add(e.getAsString());
            options.setBannedUsers(banned);
        }
    }

    static mage.game.tournament.TournamentOptions parseTournamentOptions(JsonObject args) {
        return parseTournamentOptions(args, Config.parseHostSet(Config.DEFAULT_ALLOWED_MODEL_HOSTS));
    }

    static mage.game.tournament.TournamentOptions parseTournamentOptions(JsonObject args, Set<String> allowedModelHosts) {
        String name = JsonArgs.str(args, "name", "Tournament " + System.currentTimeMillis());
        String tournamentType = JsonArgs.str(args, "tournamentType", "Elimination");
        String matchType = JsonArgs.str(args, "matchType", JsonArgs.str(args, "gameType", "Two Player Duel"));
        boolean isSingleMultiplayerGame = JsonArgs.getBool(args, "isSingleMultiplayerGame", false);
        mage.game.tournament.TournamentOptions tOpts = new mage.game.tournament.TournamentOptions(name, matchType, isSingleMultiplayerGame);
        tOpts.setTournamentType(tournamentType);
        if (args.has("numberRounds")) tOpts.setNumberRounds(JsonArgs.getInt(args, "numberRounds", 0));
        tOpts.setPassword(JsonArgs.str(args, "password", ""));
        tOpts.setQuitRatio(JsonArgs.getInt(args, "quitRatio", 100));
        if (args.has("minimumRating")) tOpts.setMinimumRating(JsonArgs.getInt(args, "minimumRating", 0));
        if (args.has("watchingAllowed")) tOpts.setWatchingAllowed(JsonArgs.getBool(args, "watchingAllowed", true));
        if (args.has("playerTypes")) {
            JsonArray arr = args.getAsJsonArray("playerTypes");
            List<PlayerType> types = new java.util.ArrayList<>();
            for (JsonElement e : arr) {
                String raw = e.getAsString();
                if ("SIM".equalsIgnoreCase(raw)) types.add(PlayerType.HUMAN);
                else try { types.add(PlayerType.valueOf(raw.toUpperCase(Locale.ROOT))); } catch (Exception ignored) {}
            }
            if (!types.isEmpty()) {
                tOpts.getPlayerTypes().clear();
                tOpts.getPlayerTypes().addAll(types);
            }
        }
        // matchOptions sub-fields
        MatchOptions mOpts = tOpts.getMatchOptions();
        applyMatchOptions(args, mOpts);
        // Tournaments: the seats are TournamentOptions.playerTypes; the server wires
        // the configs from getMatchOptions().llmPlayerConfigs to its COMPUTER_LLM seats.
        List<LLMPlayerConfig> llmConfigs = LlmConfigs.parse(args, tOpts.getPlayerTypes(), allowedModelHosts);
        if (!llmConfigs.isEmpty()) {
            mOpts.setLlmPlayerConfigs(llmConfigs);
        }
        // Fork (LLMage): same all-LLM showcase rule as parseMatchOptions. The tournament's own
        // playerTypes decide (a tournament whose LLM seats play only bots is watchable; one with
        // a HUMAN seat stays private). applyMatchOptions does not touch this flag, so set it once.
        mOpts.setLlmChatPublic(resolveLlmChatPublic(args, tOpts.getPlayerTypes()));
        // limitedOptions
        // El engine exige DraftOptions (no el base LimitedOptions) para los tipos
        // draft: BoosterDraftEliminationTournament.draft() hace
        // (DraftOptions) options.getLimitedOptions() y revienta con
        // ClassCastException si el proxy manda un LimitedOptions pelao (el torneo
        // se queda cuñado en Starting). El cliente desktop manda DraftOptions
        // siempre que tournamentType.isDraft() (NewTournamentDialog), con timing
        // elegido en combo; aquí se replica: tipos draft -> DraftOptions con
        // timing REGULAR por defecto cuando falte o sea inválido.
        boolean isDraft = tournamentType != null
                && tournamentType.toLowerCase(Locale.ROOT).contains("draft");
        if (args.has("limitedOptions") && args.get("limitedOptions").isJsonObject()) {
            JsonObject lo = args.getAsJsonObject("limitedOptions");
            mage.game.tournament.LimitedOptions lim;
            if (isDraft) {
                lim = newDraftOptionsWithDefaultTiming(lo);
            } else if (lo.has("timing")) {
                try {
                    mage.game.draft.DraftOptions draftOpts = new mage.game.draft.DraftOptions();
                    draftOpts.setTiming(mage.game.draft.DraftOptions.TimingOption.valueOf(
                            JsonArgs.str(lo, "timing", "REGULAR").toUpperCase(Locale.ROOT)));
                    lim = draftOpts;
                } catch (Exception ignored) {
                    lim = new mage.game.tournament.LimitedOptions();
                }
            } else {
                lim = new mage.game.tournament.LimitedOptions();
            }
            if (lo.has("constructionTime")) lim.setConstructionTime(JsonArgs.getInt(lo, "constructionTime", 600));
            if (lo.has("numberBoosters")) lim.setNumberBoosters(JsonArgs.getInt(lo, "numberBoosters", 3));
            if (lo.has("draftCubeName")) lim.setDraftCubeName(JsonArgs.str(lo, "draftCubeName", ""));
            try {
                java.lang.reflect.Field f = mage.game.tournament.LimitedOptions.class.getDeclaredField("sets");
                f.setAccessible(true);
                @SuppressWarnings("unchecked")
                List<String> sets = (List<String>) f.get(lim);
                if (lo.has("setCodes") && lo.get("setCodes").isJsonArray()) {
                    for (JsonElement e : lo.getAsJsonArray("setCodes")) sets.add(e.getAsString());
                } else if (lo.has("sets") && lo.get("sets").isJsonArray()) {
                    for (JsonElement e : lo.getAsJsonArray("sets")) sets.add(e.getAsString());
                }
            } catch (Exception ignored) {}
            tOpts.setLimitedOptions(lim);
        }
        if (tOpts.getLimitedOptions() == null) {
            if (isDraft) {
                mage.game.draft.DraftOptions draftOpts = new mage.game.draft.DraftOptions();
                draftOpts.setTiming(mage.game.draft.DraftOptions.TimingOption.REGULAR);
                tOpts.setLimitedOptions(draftOpts);
            } else {
                tOpts.setLimitedOptions(new mage.game.tournament.LimitedOptions());
            }
        }
        return tOpts;
    }

    private static mage.game.draft.DraftOptions newDraftOptionsWithDefaultTiming(JsonObject lo) {
        mage.game.draft.DraftOptions draftOpts = new mage.game.draft.DraftOptions();
        try {
            draftOpts.setTiming(mage.game.draft.DraftOptions.TimingOption.valueOf(
                    JsonArgs.str(lo, "timing", "REGULAR").toUpperCase(Locale.ROOT)));
        } catch (Exception ignored) {
            draftOpts.setTiming(mage.game.draft.DraftOptions.TimingOption.REGULAR);
        }
        if (draftOpts.getTiming() == null) {
            draftOpts.setTiming(mage.game.draft.DraftOptions.TimingOption.REGULAR);
        }
        return draftOpts;
    }
}
