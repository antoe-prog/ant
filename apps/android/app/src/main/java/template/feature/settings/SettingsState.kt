package template.feature.settings

data class SettingsState(
    val model: String = "gpt-4o-mini",
    val temperature: Float = 0.4f,
    val language: String = "ko",
    val debugMode: Boolean = false
)
