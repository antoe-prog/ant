import Foundation

struct HistoryItem: Identifiable {
    let id = UUID()
    let title: String
    let updatedAt: Date
}

final class HistoryStore {
    private(set) var items: [HistoryItem] = []

    func upsert(title: String) {
        items.insert(HistoryItem(title: title, updatedAt: Date()), at: 0)
    }

    func search(query: String) -> [HistoryItem] {
        guard !query.isEmpty else { return items }
        return items.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }
}
