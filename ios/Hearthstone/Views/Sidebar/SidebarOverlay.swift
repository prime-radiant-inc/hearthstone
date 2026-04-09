import SwiftUI

struct SidebarOverlay<Content: View>: View {
    @ObservedObject var router: AppRouter
    @ViewBuilder let content: () -> Content

    @State private var isOpen = false
    @GestureState private var dragOffset: CGFloat = 0

    private let sidebarWidth: CGFloat = 260
    private let edgeZone: CGFloat = 80

    var body: some View {
        GeometryReader { _ in
            ZStack(alignment: .leading) {
                content()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                if isOpen || dragOffset != 0 {
                    Color.black
                        .opacity(overlayOpacity)
                        .ignoresSafeArea()
                        .onTapGesture { close() }
                }

                HStack(spacing: 0) {
                    SidebarView(router: router, onClose: { close() })
                        .frame(width: sidebarWidth)

                    Spacer(minLength: 0)
                }
                .offset(x: currentOffset - sidebarWidth)
            }
            .gesture(
                DragGesture(minimumDistance: 10, coordinateSpace: .global)
                    .updating($dragOffset) { value, state, _ in
                        if isOpen {
                            let drag = min(0, value.translation.width)
                            state = sidebarWidth + drag
                        } else if value.startLocation.x < edgeZone {
                            state = max(0, min(sidebarWidth, value.translation.width))
                        }
                    }
                    .onEnded { value in
                        let velocity = value.predictedEndTranslation.width - value.translation.width
                        if isOpen {
                            if value.translation.width < -80 || velocity < -300 {
                                close()
                            }
                        } else if value.startLocation.x < edgeZone {
                            if dragOffset > sidebarWidth / 3 || velocity > 300 {
                                open()
                            }
                        }
                    }
            )
            .animation(.spring(response: 0.35, dampingFraction: 0.86), value: isOpen)
            .animation(.spring(response: 0.35, dampingFraction: 0.86), value: dragOffset)
        }
    }

    private var currentOffset: CGFloat {
        if dragOffset != 0 {
            return dragOffset
        }
        return isOpen ? sidebarWidth : 0
    }

    private var overlayOpacity: Double {
        Double(currentOffset / sidebarWidth) * 0.4
    }

    private func open() {
        isOpen = true
    }

    private func close() {
        isOpen = false
    }
}
