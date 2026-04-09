import SwiftUI

struct GuestDocumentsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    @State private var documents: [Document] = []
    @State private var isLoading = true
    @State private var selectedDoc: Document?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                        .tint(theme.hearth)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if documents.isEmpty {
                    VStack(spacing: 12) {
                        Text("📄").font(.system(size: 40))
                        Text("No documents available")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(theme.charcoalSoft)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(documents) { doc in
                            Button {
                                selectedDoc = doc
                            } label: {
                                HStack(spacing: 12) {
                                    Text("📄").font(.system(size: 18))

                                    Text(doc.title)
                                        .font(.system(size: 15, weight: .medium))
                                        .foregroundColor(theme.charcoal)

                                    Spacer()

                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundColor(theme.creamDeep)
                                }
                                .padding(.vertical, 4)
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .background(theme.cream)
            .navigationTitle("Documents")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(theme.hearth)
                        .fontWeight(.semibold)
                }
            }
        }
        .task {
            do {
                documents = try await APIClient.shared.listGuestDocuments()
            } catch { }
            isLoading = false
        }
        .sheet(item: $selectedDoc) { doc in
            SourceDocumentView(documentId: doc.id, documentTitle: doc.title)
        }
    }
}
