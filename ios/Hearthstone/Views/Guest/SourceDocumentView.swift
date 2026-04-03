// SourceDocumentView.swift
// Hearthstone
//
// Modal sheet showing the full cached Markdown of a source document.
// Bob Vesper (ec8ae649)

import SwiftUI

struct SourceDocumentView: View {
    let documentId: String
    let documentTitle: String

    @Environment(\.dismiss) private var dismiss
    @State private var content: String?
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = error {
                    VStack(spacing: 16) {
                        Text(error)
                            .foregroundColor(Theme.charcoalSoft)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                        Button("Try Again") { Task { await loadContent() } }
                            .foregroundColor(Theme.hearth)
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let content = content {
                    ScrollView {
                        Text(markdownAttributedString(content))
                            .font(.system(size: 15))
                            .lineSpacing(5)
                            .padding(20)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .background(Theme.cream)
            .navigationTitle(documentTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(Theme.hearth)
                        .fontWeight(.semibold)
                }
            }
        }
        .task { await loadContent() }
    }

    private func loadContent() async {
        isLoading = true
        error = nil
        do {
            // Try owner auth first (for preview mode), fall back to guest auth
            let auth: APIAuth = KeychainService.shared.ownerToken != nil ? .owner : .guest
            let doc = try await APIClient.shared.getDocumentContent(id: documentId, auth: auth)
            content = doc.markdown
        } catch {
            self.error = "Unable to load document. Please try again."
        }
        isLoading = false
    }

    private func markdownAttributedString(_ markdown: String) -> AttributedString {
        (try? AttributedString(markdown: markdown, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(markdown)
    }
}
