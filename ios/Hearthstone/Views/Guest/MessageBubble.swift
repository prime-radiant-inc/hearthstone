import SwiftUI

struct MessageBubble: View {
    let message: ChatMessage
    let onSourceTap: (ChatSource) -> Void

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 48) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
                bubbleContent

                if message.role == .assistant, !message.sources.isEmpty {
                    sourcePills
                }
            }

            if message.role == .assistant { Spacer(minLength: 48) }
        }
    }

    private var bubbleContent: some View {
        Text(LocalizedStringKey(message.content))
            .font(.system(size: 15))
            .lineSpacing(4)
            .foregroundColor(message.role == .user ? .white : theme.charcoal)
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(
                message.role == .user
                    ? theme.hearth
                    : theme.creamWarm
            )
            .clipShape(
                message.role == .user
                    ? RoundedCorners(tl: 20, tr: 20, bl: 20, br: 6)
                    : RoundedCorners(tl: 20, tr: 20, bl: 6, br: 20)
            )
            .shadow(
                color: message.role == .assistant
                    ? theme.shadowLight
                    : .clear,
                radius: 3,
                x: 0,
                y: 1
            )
    }

    private var uniqueSources: [ChatSource] {
        var seen = Set<String>()
        return message.sources.filter { seen.insert($0.documentId).inserted }
    }

    private var sourcePills: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(uniqueSources) { source in
                Button {
                    onSourceTap(source)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "doc.text")
                            .font(.system(size: 13))
                        Text(source.title)
                            .font(.system(size: 13, weight: .medium))
                    }
                    .foregroundColor(theme.hearth)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(theme.hearth.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Asymmetric rounded corners shape

private struct RoundedCorners: Shape {
    var tl: CGFloat
    var tr: CGFloat
    var bl: CGFloat
    var br: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let w = rect.width
        let h = rect.height

        path.move(to: CGPoint(x: tl, y: 0))
        path.addLine(to: CGPoint(x: w - tr, y: 0))
        path.addArc(center: CGPoint(x: w - tr, y: tr), radius: tr,
                    startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        path.addLine(to: CGPoint(x: w, y: h - br))
        path.addArc(center: CGPoint(x: w - br, y: h - br), radius: br,
                    startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        path.addLine(to: CGPoint(x: bl, y: h))
        path.addArc(center: CGPoint(x: bl, y: h - bl), radius: bl,
                    startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        path.addLine(to: CGPoint(x: 0, y: tl))
        path.addArc(center: CGPoint(x: tl, y: tl), radius: tl,
                    startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        path.closeSubpath()

        return path
    }
}

#Preview {
    VStack(spacing: 16) {
        MessageBubble(
            message: ChatMessage(role: .user, content: "What's the WiFi password?", sources: []),
            onSourceTap: { _ in }
        )
        MessageBubble(
            message: ChatMessage(
                role: .assistant,
                content: "The guest WiFi is Pantomime 5G and the password is passwordsarehard.",
                sources: [ChatSource(documentId: "1", title: "WiFi & Networks", chunkIndex: 0)]
            ),
            onSourceTap: { _ in }
        )
    }
    .padding()
    .background(Color(red: 245/255, green: 237/255, blue: 224/255))
}
