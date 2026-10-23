package org.mage.proxy;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ErrorClassifierTest {

    @Test
    void aServerOnAnotherReleaseIsAVersionMismatch() {
        String detail = "mage.remote.MageVersionException: Wrong client version.<br/>Your version: 1.4.62-V1 (build: 2026-10-17 20:10)"
                + "<br/>Server version: 1.4.63-V1 (build: 2026-10-20 09:00)<br/>App download: http://xmage.today";
        assertEquals(ProxyProtocol.ERR_VERSION_MISMATCH, ErrorClassifier.classifyErrorCode(detail));
        assertEquals(ProxyProtocol.ERR_VERSION_MISMATCH,
                ErrorClassifier.classifyErrorCode(ErrorClassifier.stripServerErrorPrefix("Remote task error: " + detail)));
    }

    @Test
    void otherLoginFailuresKeepTheirCodes() {
        assertEquals(ProxyProtocol.ERR_PASSWORD, ErrorClassifier.classifyErrorCode("Wrong password"));
        assertEquals(ProxyProtocol.ERR_PASSWORD, ErrorClassifier.classifyLoginFailure("Wrong password"));
    }

    /**
     * A refused login that carries the server's own text but matches no specific class gets its
     * own code: the 14-character username limit used to answer FAILED with the right text.
     */
    @Test
    void aRefusalWithTheServersOwnTextIsAServerMessage() {
        String detail = "User name may not be longer than 14 characters";
        assertEquals(ProxyProtocol.ERR_SERVER_MESSAGE, ErrorClassifier.classifyLoginFailure(detail));
        assertEquals(ProxyProtocol.ERR_SERVER_MESSAGE,
                ErrorClassifier.classifyLoginFailure("Error while connecting to server\n" + detail));
    }

    @Test
    void aSpecificClassStillWinsOverTheServerMessageFallback() {
        assertEquals(ProxyProtocol.ERR_VERSION_MISMATCH, ErrorClassifier.classifyLoginFailure("Wrong client version."));
    }

    /** Nothing captured must stay the bare FAILED contract, never SERVER_MESSAGE. */
    @Test
    void aBareRefusalStaysFailed() {
        assertEquals(ProxyProtocol.ERR_FAILED, ErrorClassifier.classifyLoginFailure(null));
        assertEquals(ProxyProtocol.ERR_FAILED, ErrorClassifier.classifyLoginFailure(""));
        assertEquals(ProxyProtocol.ERR_FAILED, ErrorClassifier.classifyLoginFailure("   "));
        assertEquals(ProxyProtocol.ERR_FAILED, ErrorClassifier.classifyLoginFailure(ProxyProtocol.ERR_FAILED));
        assertEquals(ProxyProtocol.ERR_FAILED, ErrorClassifier.classifyLoginFailure("No message"));
    }
}
