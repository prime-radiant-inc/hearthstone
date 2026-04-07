import SwiftUI

struct SidebarOverlay<Content: View>: View {
    @ObservedObject var router: AppRouter
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
    }
}
