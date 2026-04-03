import SwiftUI

struct VerifyCodeView: View {
    @ObservedObject var viewModel: AuthViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Progress dots (step 1 of 3)
            ProgressDots(active: 1, total: 3)
                .padding(.bottom, 36)

            // Subtitle
            Text("Check your inbox")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(Theme.hearth)
                .padding(.bottom, 8)

            // Heading
            Text("Enter your code")
                .font(Theme.heading(28))
                .foregroundColor(Theme.charcoal)
                .padding(.bottom, 10)

            // Email confirmation
            Group {
                Text("We sent a 6-digit code to ")
                    .foregroundColor(Theme.charcoalSoft)
                + Text(viewModel.email)
                    .fontWeight(.semibold)
                    .foregroundColor(Theme.charcoal)
            }
            .font(.system(size: 15))
            .lineSpacing(4)
            .padding(.bottom, 32)

            // Code input — single field, monospaced, centered
            TextField("", text: $viewModel.code)
                .font(.system(size: 28, weight: .semibold, design: .monospaced))
                .multilineTextAlignment(.center)
                .keyboardType(.numberPad)
                .tracking(12)
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radiusMedium)
                        .stroke(
                            viewModel.code.isEmpty ? Theme.creamDeep : Theme.hearth,
                            lineWidth: 1.5
                        )
                )
                .onChange(of: viewModel.code) { _, newValue in
                    // Enforce digits only and max 6 chars
                    let filtered = String(newValue.filter(\.isNumber).prefix(6))
                    if filtered != newValue { viewModel.code = filtered }
                    if filtered.count == 6 {
                        Task { await viewModel.verifyCode() }
                    }
                }
                .padding(.bottom, 24)

            // Error
            if let error = viewModel.error {
                Text(error)
                    .font(.system(size: 14))
                    .foregroundColor(Theme.rose)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.bottom, 12)
            }

            // Resend link
            HStack {
                Spacer()
                Text("Didn't get it? ")
                    .font(.system(size: 14))
                    .foregroundColor(Theme.stone)
                + Text("Resend code")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Theme.hearth)
                Spacer()
            }

            if viewModel.isLoading {
                HStack {
                    Spacer()
                    ProgressView()
                        .tint(Theme.hearth)
                        .padding(.top, 24)
                    Spacer()
                }
            }

            Spacer()

            // Expiry note
            Text("Code expires in 10 minutes")
                .font(.system(size: 13))
                .foregroundColor(Theme.stone)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.bottom, 34)
        }
        .padding(.horizontal, 24)
        .padding(.top, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.cream.ignoresSafeArea())
    }
}

#Preview {
    VerifyCodeView(viewModel: {
        let vm = AuthViewModel()
        vm.email = "fred@example.com"
        return vm
    }())
}
