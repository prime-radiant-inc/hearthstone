import SwiftUI

struct VerifyCodeView: View {
    @ObservedObject var viewModel: AuthViewModel

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ProgressDots(active: 1, total: 3)
                .padding(.bottom, 36)

            Text("Check your inbox")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(theme.hearth)
                .padding(.bottom, 8)

            Text("Enter your code")
                .font(Theme.heading(28))
                .foregroundColor(theme.charcoal)
                .padding(.bottom, 10)

            Group {
                Text("We sent a 6-digit code to ")
                    .foregroundColor(theme.charcoalSoft)
                + Text(viewModel.email)
                    .fontWeight(.semibold)
                    .foregroundColor(theme.charcoal)
            }
            .font(.system(size: 15))
            .lineSpacing(4)
            .padding(.bottom, 32)

            TextField("", text: $viewModel.code)
                .font(.system(size: 28, weight: .semibold, design: .monospaced))
                .multilineTextAlignment(.center)
                .keyboardType(.numberPad)
                .tracking(12)
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity)
                .background(theme.creamWarm)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radiusMedium)
                        .stroke(
                            viewModel.code.isEmpty ? theme.creamDeep : theme.hearth,
                            lineWidth: 1.5
                        )
                )
                .onChange(of: viewModel.code) { _, newValue in
                    let filtered = String(newValue.filter(\.isNumber).prefix(6))
                    if filtered != newValue { viewModel.code = filtered }
                    if filtered.count == 6 {
                        Task { await viewModel.verifyCode() }
                    }
                }
                .padding(.bottom, 24)

            if let error = viewModel.error {
                Text(error)
                    .font(.system(size: 14))
                    .foregroundColor(theme.rose)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.bottom, 12)
            }

            HStack {
                Spacer()
                Text("Didn't get it? ")
                    .font(.system(size: 14))
                    .foregroundColor(theme.stone)
                + Text("Resend code")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(theme.hearth)
                Spacer()
            }

            if viewModel.isLoading {
                HStack {
                    Spacer()
                    ProgressView()
                        .tint(theme.hearth)
                        .padding(.top, 24)
                    Spacer()
                }
            }

            Spacer()

            Text("Code expires in 10 minutes")
                .font(.system(size: 13))
                .foregroundColor(theme.stone)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.bottom, 34)
        }
        .padding(.horizontal, 24)
        .padding(.top, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.cream.ignoresSafeArea())
    }
}

#Preview {
    VerifyCodeView(viewModel: {
        let vm = AuthViewModel()
        vm.email = "fred@example.com"
        return vm
    }())
}
