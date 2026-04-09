import SwiftUI
import UIKit

// MARK: - Edge Swipe Gesture (UIKit bridge for iOS 17+)

/// Transparent overlay that captures UIScreenEdgePanGestureRecognizer events.
/// This doesn't conflict with ScrollView gestures because the UIKit gesture recognizer
/// operates in a separate gesture hierarchy from SwiftUI.
struct EdgePanOverlay: UIViewRepresentable {
    let edge: UIRectEdge
    var onChanged: (CGFloat) -> Void
    var onEnded: (CGFloat, CGFloat) -> Void  // (translation, velocity)

    func makeUIView(context: Context) -> UIView {
        let view = EdgePanView()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = true

        let gesture = UIScreenEdgePanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handlePan(_:)))
        gesture.edges = edge
        view.addGestureRecognizer(gesture)

        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.onChanged = onChanged
        context.coordinator.onEnded = onEnded
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onChanged: onChanged, onEnded: onEnded)
    }

    /// Subclass that only intercepts touches at the screen edge.
    class EdgePanView: UIView {
        override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
            // Only capture touches in the leftmost 30pt — let everything else pass through
            if point.x < 30 {
                return super.hitTest(point, with: event)
            }
            return nil
        }
    }

    class Coordinator: NSObject {
        var onChanged: (CGFloat) -> Void
        var onEnded: (CGFloat, CGFloat) -> Void

        init(onChanged: @escaping (CGFloat) -> Void, onEnded: @escaping (CGFloat, CGFloat) -> Void) {
            self.onChanged = onChanged
            self.onEnded = onEnded
        }

        @objc func handlePan(_ recognizer: UIScreenEdgePanGestureRecognizer) {
            guard let view = recognizer.view else { return }
            let translation = recognizer.translation(in: view).x
            let velocity = recognizer.velocity(in: view).x

            switch recognizer.state {
            case .changed:
                onChanged(translation)
            case .ended, .cancelled:
                onEnded(translation, velocity)
            default:
                break
            }
        }
    }
}

// MARK: - SidebarOverlay

struct SidebarOverlay<Content: View>: View {
    @ObservedObject var router: AppRouter
    @ViewBuilder let content: () -> Content

    @State private var isOpen = false
    @State private var dragOffset: CGFloat = 0

    private let sidebarWidth: CGFloat = 260

    var body: some View {
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
            .offset(x: currentOffset - sidebarWidth)

            // Edge swipe overlay — only captures touches at the left edge
            if !isOpen {
                EdgePanOverlay(edge: .left) { translation in
                    dragOffset = max(0, min(sidebarWidth, translation))
                } onEnded: { translation, velocity in
                    if translation > sidebarWidth / 3 || velocity > 300 {
                        open()
                    } else {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.86)) {
                            dragOffset = 0
                        }
                    }
                }
                .ignoresSafeArea()
            }
        }
        .gesture(
            // Close gesture: drag left when sidebar is open
            DragGesture(minimumDistance: 20)
                .onChanged { value in
                    guard isOpen else { return }
                    let drag = min(0, value.translation.width)
                    dragOffset = sidebarWidth + drag
                }
                .onEnded { value in
                    guard isOpen else { return }
                    let velocity = value.predictedEndTranslation.width - value.translation.width
                    if value.translation.width < -60 || velocity < -300 {
                        close()
                    } else {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.86)) {
                            dragOffset = 0
                        }
                    }
                }
        )
        .animation(.spring(response: 0.35, dampingFraction: 0.86), value: isOpen)
    }

    private var currentOffset: CGFloat {
        if dragOffset > 0 {
            return dragOffset
        }
        return isOpen ? sidebarWidth : 0
    }

    private var overlayOpacity: Double {
        Double(currentOffset / sidebarWidth) * 0.4
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
