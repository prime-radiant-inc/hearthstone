import SwiftUI

struct SidebarOverlay<Content: View>: View {
    @ObservedObject var router: AppRouter
    @ViewBuilder let content: () -> Content

    @State private var isOpen = false
    @State private var dragOffset: CGFloat = 0

    private let sidebarWidth: CGFloat = 260

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                content()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                if isOpen || dragOffset > 0 {
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
                .offset(x: sidebarOffset - sidebarWidth)
            }
            .gesture(
                DragGesture(minimumDistance: 12)
                    .onChanged { value in
                        if isOpen {
                            let drag = min(0, value.translation.width)
                            dragOffset = sidebarWidth + drag
                        } else if value.startLocation.x < 50 {
                            dragOffset = max(0, min(sidebarWidth, value.translation.width))
                        }
                    }
                    .onEnded { value in
                        if isOpen {
                            if value.translation.width < -80 || value.predictedEndTranslation.width < -120 {
                                close()
                            } else {
                                open()
                            }
                        } else {
                            if dragOffset > sidebarWidth / 3 || value.predictedEndTranslation.width > 120 {
                                open()
                            } else {
                                close()
                            }
                        }
                    }
            )
            .animation(.easeOut(duration: 0.25), value: isOpen)
        }
    }

    private var sidebarOffset: CGFloat {
        if isOpen && dragOffset == 0 {
            return sidebarWidth
        }
        return dragOffset
    }

    private var overlayOpacity: Double {
        Double(sidebarOffset / sidebarWidth) * 0.4
    }

    private func open() {
        dragOffset = 0
        isOpen = true
    }

    private func close() {
        dragOffset = 0
        isOpen = false
    }
}
