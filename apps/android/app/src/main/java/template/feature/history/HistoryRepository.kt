package template.feature.history

data class HistoryItem(
    val id: String,
    val title: String,
    val updatedAt: Long
)

class HistoryRepository {
    private val items = mutableListOf<HistoryItem>()

    fun snapshot(): List<HistoryItem> = items.toList()

    fun upsert(item: HistoryItem) {
        items.add(0, item)
    }

    fun search(query: String): List<HistoryItem> {
        if (query.isBlank()) return items
        return items.filter { it.title.contains(query, ignoreCase = true) }
    }
}
