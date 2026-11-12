// Heart.kt — heart rate from the watch's sensor while a workout is on screen (Health Services' measure client).
// Workout.logSet adds what was measured since the last set to the session's average and peak.
package app.propertystars.planner.watch

import android.content.Context
import androidx.health.services.client.HealthServices
import androidx.health.services.client.MeasureCallback
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.DeltaDataType

data class HeartSummary(val avg: Int, val max: Int, val samples: Int)

class Heart(context: Context, private val onBpm: (Int) -> Unit) {
    private val client = HealthServices.getClient(context.applicationContext).measureClient
    private var sum = 0L
    private var count = 0
    private var peak = 0
    private var on = false

    private val callback = object : MeasureCallback {
        override fun onAvailabilityChanged(dataType: DeltaDataType<*, *>, availability: Availability) {}
        override fun onDataReceived(data: DataPointContainer) {
            val last = data.getData(DataType.HEART_RATE_BPM).lastOrNull() ?: return
            val bpm = last.value.toInt()
            if (bpm < 30 || bpm > 230) return
            sum += bpm; count++; if (bpm > peak) peak = bpm
            onBpm(bpm)
        }
    }

    fun start() {
        if (on) return
        on = true
        try { client.registerMeasureCallback(DataType.HEART_RATE_BPM, callback) } catch (_: Exception) { on = false }
    }

    fun stop() {
        if (!on) return
        on = false
        try { client.unregisterMeasureCallbackAsync(DataType.HEART_RATE_BPM, callback) } catch (_: Exception) { }
    }

    /** What was measured since the last call (it starts again from zero), to add to what the session already has. */
    fun take(): HeartSummary? {
        if (count == 0) return null
        val s = HeartSummary((sum / count).toInt(), peak, count)
        sum = 0; count = 0; peak = 0
        return s
    }
}
