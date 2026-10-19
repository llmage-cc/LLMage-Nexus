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
        assertEquals(ProxyProtocol.ERR_FAILED, ErrorClassifier.classifyErrorCode("User name may not be longer than 14 characters"));
    }
}
