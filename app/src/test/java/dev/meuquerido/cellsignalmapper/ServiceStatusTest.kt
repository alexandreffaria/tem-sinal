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
import android.telephony.TelephonyManager.NETWORK_TYPE_IWLAN
import android.telephony.TelephonyManager.NETWORK_TYPE_LTE
import android.telephony.TelephonyManager.NETWORK_TYPE_UNKNOWN
import org.junit.Assert.assertEquals
import org.junit.Test

/** Made-up service states, mapped by the **Service state** rule in `docs/sample-schema.md`. */
class ServiceStatusTest {
    private val homeVoice = NetworkRegistration(
        TRANSPORT_TYPE_WWAN, NETWORK_TYPE_LTE, registered = true,
        availableServices = listOf(SERVICE_TYPE_VOICE, SERVICE_TYPE_SMS, SERVICE_TYPE_EMERGENCY),
    )
    private val cellularEmergencyOnly = NetworkRegistration(
        TRANSPORT_TYPE_WWAN, NETWORK_TYPE_LTE, registered = false,
        availableServices = listOf(SERVICE_TYPE_EMERGENCY),
    )
    private val cellularNone = NetworkRegistration(
        TRANSPORT_TYPE_WWAN, NETWORK_TYPE_UNKNOWN, registered = false,
        availableServices = emptyList(),
    )
    private val wifiCalling = NetworkRegistration(
        TRANSPORT_TYPE_WLAN, NETWORK_TYPE_IWLAN, registered = true,
        availableServices = listOf(SERVICE_TYPE_VOICE, SERVICE_TYPE_EMERGENCY),
    )

    /** Wi-Fi calling as legacy-mode IWLAN reports it: the cellular PS entry, registered home. */
    private val legacyIwlanData = NetworkRegistration(
        TRANSPORT_TYPE_WWAN, NETWORK_TYPE_IWLAN, registered = true,
        availableServices = listOf(SERVICE_TYPE_DATA),
    )

    private fun status(state: Int, registrations: List<NetworkRegistration>) =
        serviceStatus(state, registrations, airplaneModeOn = false)

    @Test
    fun powerOffWinsOverEverythingElse() {
        assertEquals(ServiceStatus.POWER_OFF, status(STATE_POWER_OFF, listOf(homeVoice)))
        assertEquals(ServiceStatus.POWER_OFF, status(STATE_POWER_OFF, emptyList()))
    }

    @Test
    fun airplaneModeIsPowerOffWhateverTheStateSays() {
        assertEquals(
            ServiceStatus.POWER_OFF,
            serviceStatus(STATE_OUT_OF_SERVICE, listOf(cellularNone), airplaneModeOn = true),
        )
    }

    @Test
    fun airplaneModeWithWifiCallingIsPowerOff() {
        assertEquals(
            ServiceStatus.POWER_OFF,
            serviceStatus(
                STATE_IN_SERVICE, listOf(cellularNone, cellularNone, wifiCalling),
                airplaneModeOn = true,
            ),
        )
    }

    @Test
    fun airplaneModeWithARegisteredCellularNetworkIsInService() {
        assertEquals(
            ServiceStatus.IN_SERVICE,
            serviceStatus(STATE_IN_SERVICE, listOf(homeVoice), airplaneModeOn = true),
        )
    }

    @Test
    fun registeredCellularNetworkIsInService() {
        assertEquals(ServiceStatus.IN_SERVICE, status(STATE_IN_SERVICE, listOf(homeVoice)))
    }

    @Test
    fun inServiceStateWithNoCellularRegistrationListedIsInService() {
        assertEquals(ServiceStatus.IN_SERVICE, status(STATE_IN_SERVICE, emptyList()))
    }

    @Test
    fun roamingDataOnlyRegistrationIsInService() {
        val roamingData = NetworkRegistration(
            TRANSPORT_TYPE_WWAN, NETWORK_TYPE_LTE, registered = true,
            availableServices = listOf(SERVICE_TYPE_DATA),
        )

        assertEquals(
            ServiceStatus.IN_SERVICE,
            status(STATE_OUT_OF_SERVICE, listOf(cellularNone, roamingData)),
        )
    }

    @Test
    fun outOfServiceWithOnlyEmergencyAvailableIsEmergencyOnly() {
        assertEquals(
            ServiceStatus.EMERGENCY_ONLY,
            status(STATE_OUT_OF_SERVICE, listOf(cellularNone, cellularEmergencyOnly)),
        )
    }

    @Test
    fun emergencyOnlyStateIsEmergencyOnly() {
        assertEquals(ServiceStatus.EMERGENCY_ONLY, status(STATE_EMERGENCY_ONLY, emptyList()))
    }

    @Test
    fun outOfServiceWithNothingAvailableIsOutOfService() {
        assertEquals(
            ServiceStatus.OUT_OF_SERVICE, status(STATE_OUT_OF_SERVICE, listOf(cellularNone)),
        )
        assertEquals(ServiceStatus.OUT_OF_SERVICE, status(STATE_OUT_OF_SERVICE, emptyList()))
    }

    @Test
    fun wifiCallingRegistrationDoesNotCountAsCellService() {
        assertEquals(
            ServiceStatus.OUT_OF_SERVICE, status(STATE_OUT_OF_SERVICE, listOf(wifiCalling)),
        )
    }

    @Test
    fun inServiceStateFromWifiCallingWithNoCellularRegistrationIsOutOfService() {
        assertEquals(
            ServiceStatus.OUT_OF_SERVICE,
            status(STATE_IN_SERVICE, listOf(cellularNone, cellularNone, wifiCalling)),
        )
    }

    @Test
    fun inServiceStateFromWifiCallingWithCellularEmergencyIsEmergencyOnly() {
        assertEquals(
            ServiceStatus.EMERGENCY_ONLY,
            status(STATE_IN_SERVICE, listOf(cellularNone, cellularEmergencyOnly, wifiCalling)),
        )
    }

    @Test
    fun legacyIwlanCellularEntryDoesNotCountAsCellService() {
        assertEquals(
            ServiceStatus.OUT_OF_SERVICE,
            status(STATE_IN_SERVICE, listOf(cellularNone, legacyIwlanData)),
        )
    }

    @Test
    fun airplaneModeWithLegacyIwlanCellularEntryIsPowerOff() {
        assertEquals(
            ServiceStatus.POWER_OFF,
            serviceStatus(
                STATE_IN_SERVICE, listOf(cellularNone, legacyIwlanData), airplaneModeOn = true,
            ),
        )
    }

    @Test
    fun registeredLteCellularEntryIsInService() {
        val lteData = legacyIwlanData.copy(accessNetworkTechnology = NETWORK_TYPE_LTE)

        assertEquals(
            ServiceStatus.IN_SERVICE, status(STATE_IN_SERVICE, listOf(cellularNone, lteData)),
        )
    }
}
