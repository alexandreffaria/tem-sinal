package dev.meuquerido.cellsignalmapper

import android.telephony.AccessNetworkConstants.TRANSPORT_TYPE_WLAN
import android.telephony.AccessNetworkConstants.TRANSPORT_TYPE_WWAN
import android.telephony.NetworkRegistrationInfo.SERVICE_TYPE_DATA
import android.telephony.NetworkRegistrationInfo.SERVICE_TYPE_EMERGENCY
import android.telephony.NetworkRegistrationInfo.SERVICE_TYPE_SMS
import android.telephony.NetworkRegistrationInfo.SERVICE_TYPE_VOICE
import android.telephony.ServiceState.STATE_EMERGENCY_ONLY
import android.telephony.ServiceState.STATE_IN_SERVICE
import android.telephony.ServiceState.STATE_OUT_OF_SERVICE
import android.telephony.ServiceState.STATE_POWER_OFF
import org.junit.Assert.assertEquals
import org.junit.Test

/** Made-up service states, mapped by the **Service state** rule in `docs/sample-schema.md`. */
class ServiceStatusTest {
    private val homeVoice = NetworkRegistration(
        TRANSPORT_TYPE_WWAN, registered = true,
        availableServices = listOf(SERVICE_TYPE_VOICE, SERVICE_TYPE_SMS, SERVICE_TYPE_EMERGENCY),
    )
    private val cellularEmergencyOnly = NetworkRegistration(
        TRANSPORT_TYPE_WWAN, registered = false, availableServices = listOf(SERVICE_TYPE_EMERGENCY),
    )
    private val cellularNone = NetworkRegistration(
        TRANSPORT_TYPE_WWAN, registered = false, availableServices = emptyList(),
    )

    @Test
    fun powerOffWinsOverEverythingElse() {
        assertEquals(ServiceStatus.POWER_OFF, serviceStatus(STATE_POWER_OFF, listOf(homeVoice)))
        assertEquals(ServiceStatus.POWER_OFF, serviceStatus(STATE_POWER_OFF, emptyList()))
    }

    @Test
    fun inServiceStateIsInService() {
        assertEquals(ServiceStatus.IN_SERVICE, serviceStatus(STATE_IN_SERVICE, listOf(homeVoice)))
        assertEquals(ServiceStatus.IN_SERVICE, serviceStatus(STATE_IN_SERVICE, emptyList()))
    }

    @Test
    fun roamingDataOnlyRegistrationIsInService() {
        val roamingData = NetworkRegistration(
            TRANSPORT_TYPE_WWAN, registered = true, availableServices = listOf(SERVICE_TYPE_DATA),
        )

        assertEquals(
            ServiceStatus.IN_SERVICE,
            serviceStatus(STATE_OUT_OF_SERVICE, listOf(cellularNone, roamingData)),
        )
    }

    @Test
    fun outOfServiceWithOnlyEmergencyAvailableIsEmergencyOnly() {
        assertEquals(
            ServiceStatus.EMERGENCY_ONLY,
            serviceStatus(STATE_OUT_OF_SERVICE, listOf(cellularNone, cellularEmergencyOnly)),
        )
    }

    @Test
    fun emergencyOnlyStateIsEmergencyOnly() {
        assertEquals(ServiceStatus.EMERGENCY_ONLY, serviceStatus(STATE_EMERGENCY_ONLY, emptyList()))
    }

    @Test
    fun outOfServiceWithNothingAvailableIsOutOfService() {
        assertEquals(
            ServiceStatus.OUT_OF_SERVICE,
            serviceStatus(STATE_OUT_OF_SERVICE, listOf(cellularNone)),
        )
        assertEquals(ServiceStatus.OUT_OF_SERVICE, serviceStatus(STATE_OUT_OF_SERVICE, emptyList()))
    }

    @Test
    fun wifiCallingRegistrationDoesNotCountAsCellService() {
        val wifiCalling = NetworkRegistration(
            TRANSPORT_TYPE_WLAN, registered = true,
            availableServices = listOf(SERVICE_TYPE_VOICE, SERVICE_TYPE_EMERGENCY),
        )

        assertEquals(
            ServiceStatus.OUT_OF_SERVICE,
            serviceStatus(STATE_OUT_OF_SERVICE, listOf(wifiCalling)),
        )
    }
}
