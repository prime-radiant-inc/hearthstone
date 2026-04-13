// SourceDocumentView.swift
// Hearthstone

import SwiftUI
import WebKit

struct SourceDocumentView: View {
    let documentId: String
    let documentTitle: String
    var chunkIndex: Int?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }
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
                            .foregroundColor(theme.charcoalSoft)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                        Button("Try Again") { Task { await loadContent() } }
                            .foregroundColor(theme.hearth)
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let htmlContent = htmlContent {
                    WebView(html: htmlContent, scrollToChunk: chunkIndex)
                }
            }
            .background(theme.cream)
            .navigationTitle(documentTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(theme.hearth)
                        .fontWeight(.semibold)
                }
            }
        }
        .task { await loadContent() }
    }

    private func loadContent() async {
        isLoading = true
        error = nil
        guard let client = await SessionStore.shared.activeSession?.apiClient() else {
            self.error = "No active session."
            isLoading = false
            return
        }
        do {
            let doc = try await client.getDocumentContent(id: documentId)
            htmlContent = doc.html
        } catch {
            self.error = "Unable to load document. Please try again."
        }
        isLoading = false
    }
}

struct WebView: UIViewRepresentable {
    let html: String
    var scrollToChunk: Int?

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.navigationDelegate = context.coordinator
        context.coordinator.scrollToChunk = scrollToChunk
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.scrollToChunk = scrollToChunk
        webView.loadHTMLString(html, baseURL: nil)
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        var scrollToChunk: Int?

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            if navigationAction.navigationType == .other {
                return .allow
            }
            return .cancel
        }

        // After the page finishes loading, scroll to the target chunk
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let index = scrollToChunk else { return }
            webView.evaluateJavaScript("scrollToChunk(\(index))") { _, _ in }
        }
    }
}
