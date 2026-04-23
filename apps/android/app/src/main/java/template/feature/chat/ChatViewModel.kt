package template.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import template.feature.history.HistoryItem
import template.feature.history.HistoryRepository
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

data class ChatMessage(val role: String, val text: String)
data class ChatUiState(
    val isLoading: Boolean = false,
    val messages: List<ChatMessage> = emptyList()
)

class ChatViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState

    private val sessionId: String = UUID.randomUUID().toString()
    private val historyRepository = HistoryRepository()

    /** 설정과 맞출 것 (기본은 게이트웨이 예시 모델). */
    var chatModel: String = "gpt-4o-mini"
    var chatTemperature: Double = 0.4

    /** Emulator default `http://10.0.2.2:8000` — override with env `GATEWAY_BASE_URL`. */
    private fun gatewayBaseUrl(): String =
        System.getenv("GATEWAY_BASE_URL") ?: "http://10.0.2.2:8000"

    fun send(text: String) {
        if (text.isBlank()) return
        viewModelScope.launch {
            _uiState.update { state ->
                state.copy(
                    isLoading = true,
                    messages = state.messages + ChatMessage("user", text)
                )
            }
            val reply = runCatching { postChat(text) }.getOrElse { e -> "Request failed: ${e.message}" }
            _uiState.update { state ->
                state.copy(
                    isLoading = false,
                    messages = state.messages + ChatMessage("assistant", reply)
                )
            }
            if (!reply.startsWith("HTTP ") && !reply.startsWith("Request failed")) {
                val title = if (text.length > 120) text.take(120) + "…" else text
                historyRepository.upsert(
                    HistoryItem(
                        id = UUID.randomUUID().toString(),
                        title = title,
                        updatedAt = System.currentTimeMillis()
                    )
                )
            }
        }
    }

    private suspend fun postChat(text: String): String = withContext(Dispatchers.IO) {
        val base = gatewayBaseUrl().trimEnd('/')
        val url = URL("$base/v1/chat")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 60_000
        }
        val payload = JSONObject().apply {
            put("user_id", "android-local")
            put("session_id", sessionId)
            put("message", text)
            put("temperature", chatTemperature)
            if (chatModel.isNotBlank()) put("model", chatModel)
        }
        conn.outputStream.use { os ->
            os.write(payload.toString().toByteArray(Charsets.UTF_8))
        }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val body = BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
        if (code !in 200..299) {
            return@withContext "HTTP $code: ${body.take(200)}"
        }
        val json = JSONObject(body)
        json.optString("answer", body)
    }
}
