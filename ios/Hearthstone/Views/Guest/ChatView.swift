import SwiftUI

struct ChatView: View {
    @ObservedObject var viewModel: ChatViewModel
    let householdName: String

    @State private var selectedSource: ChatSource?
    @State private var showDocuments = false
    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(spacing: 0) {
            chatHeader
            messageArea
            inputBar
        }
        .background(theme.cream)
        .sheet(item: $selectedSource) { source in
            SourceDocumentView(documentId: source.documentId, documentTitle: source.title, chunkIndex: source.chunkIndex)
        }
        .sheet(isPresented: $showDocuments) {
            GuestDocumentsView()
        }
        .alert("Error", isPresented: Binding(
            get: { viewModel.error != nil },
            set: { if !$0 { viewModel.error = nil } }
        )) {
            Button("OK") { viewModel.error = nil }
        } message: {
            Text(viewModel.error ?? "")
        }
    }

    // MARK: - Chat Header

    private var chatHeader: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(theme.hearth)
                    .frame(width: 40, height: 40)
                Text("H")
                    .font(Theme.heading(18))
                    .foregroundColor(.white)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(householdName)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(theme.charcoal)
                Text("Ask me anything about the house")
                    .font(.system(size: 13))
                    .foregroundColor(theme.stone)
            }

            Spacer()

            Menu {
                Button {
                    showDocuments = true
                } label: {
                    Label("Documents", systemImage: "doc.text")
                }

                Button {
                    viewModel.clearChat()
                } label: {
                    Label("New Chat", systemImage: "plus.bubble")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(theme.stone)
                    .frame(width: 32, height: 32)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 14)
        .background(theme.cream)
        .overlay(
            Rectangle()
                .fill(theme.creamDeep)
                .frame(height: 1),
            alignment: .bottom
        )
    }

    // MARK: - Message Area

    private var messageArea: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if viewModel.messages.isEmpty {
                    emptyState
                        .frame(maxWidth: .infinity)
                } else {
                    LazyVStack(spacing: 16) {
                        ForEach(viewModel.messages) { message in
                            MessageBubble(message: message) { source in
                                selectedSource = source
                            }
                            .id(message.id)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                }
            }
            .background(theme.creamWarm)
            .onChange(of: viewModel.messages.count) { _, _ in
                if let lastId = viewModel.messages.last?.id {
                    withAnimation {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
            .onChange(of: viewModel.messages.last?.content) { _, _ in
                if let lastId = viewModel.messages.last?.id {
                    proxy.scrollTo(lastId, anchor: .bottom)
                }
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Spacer()
            Text("🏡")
                .font(.system(size: 48))
            Text("What do you need to know?")
                .font(Theme.heading(20))
                .foregroundColor(theme.charcoal)
            Text("Ask about WiFi, home systems, kids routines, emergency contacts, and more.")
                .font(.system(size: 14))
                .foregroundColor(theme.stone)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .frame(maxWidth: 260)
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 40)
        .frame(minHeight: 300)
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Ask about the house...", text: $viewModel.inputText)
                .font(.system(size: 15))
                .foregroundColor(theme.charcoal)
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .background(theme.creamWarm)
                .overlay(
                    Capsule()
                        .stroke(theme.creamDeep, lineWidth: 1.5)
                )
                .clipShape(Capsule())
                .onSubmit {
                    Task { await viewModel.send() }
                }

            Button {
                Task { await viewModel.send() }
            } label: {
                ZStack {
                    Circle()
                        .fill(canSend ? theme.hearth : theme.creamDeep)
                        .frame(width: 42, height: 42)
                        .shadow(
                            color: canSend ? theme.hearth.opacity(0.3) : .clear,
                            radius: 4,
                            x: 0,
                            y: 2
                        )
                    Image(systemName: "arrow.up")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                }
            }
            .disabled(!canSend)
            .animation(.easeInOut(duration: 0.15), value: canSend)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 16)
        .background(theme.cream)
        .overlay(
            Rectangle()
                .fill(theme.creamDeep)
                .frame(height: 1),
            alignment: .top
        )
    }

    private var canSend: Bool {
        !viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !viewModel.isStreaming
    }
}


#Preview("Empty State") {
    ChatView(
        viewModel: ChatViewModel(),
        householdName: "Anderson Household"
    )
}

#Preview("With Messages") {
    ChatView(
        viewModel: {
            let vm = ChatViewModel()
            vm.messages = [
                ChatMessage(role: .user, content: "What's the WiFi password?", sources: []),
                ChatMessage(
                    role: .assistant,
                    content: "The guest WiFi network is Pantomime 5G and the password is passwordsarehard.",
                    sources: [ChatSource(documentId: "doc1", title: "WiFi & Networks", chunkIndex: 0)]
                )
            ]
            return vm
        }(),
        householdName: "Anderson Household"
    )
}
