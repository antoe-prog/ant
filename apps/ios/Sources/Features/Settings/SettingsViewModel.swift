import Foundation

@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var selectedModel = "gpt-4o-mini"
    @Published var temperature: Double = 0.4
    @Published var language = "ko"
    @Published var debugMode = false
}
