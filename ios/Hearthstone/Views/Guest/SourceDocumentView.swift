// SourceDocumentView.swift
// Hearthstone
//
// Modal sheet showing the full cached Markdown of a source document.
// Ichor (ec8ae649)

import SwiftUI
import WebKit

struct SourceDocumentView: View {
    let documentId: String
    let documentTitle: String

    @Environment(\.dismiss) private var dismiss
    @State private var htmlContent: String?
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
                } else if let htmlContent = htmlContent {
                    WebView(html: htmlContent)
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
            htmlContent = doc.html
        } catch {
            self.error = "Unable to load document. Please try again."
        }
        isLoading = false
    }
}

struct WebView: UIViewRepresentable {
    let html: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.navigationDelegate = context.coordinator
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        webView.loadHTMLString(html, baseURL: nil)
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        // Block all navigation — this is a read-only document viewer
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            if navigationAction.navigationType == .other {
                return .allow // Allow initial HTML load
            }
            return .cancel // Block link taps
        }
    }
}
