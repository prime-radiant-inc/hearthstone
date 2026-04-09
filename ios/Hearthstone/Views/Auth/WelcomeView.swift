import SwiftUI

struct WelcomeView: View {
    @ObservedObject var viewModel: AuthViewModel

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [theme.cream, theme.creamWarm],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                ZStack {
                    RoundedRectangle(cornerRadius: 24)
                        .fill(
                            LinearGradient(
                                colors: [theme.hearth, theme.hearthDark],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 88, height: 88)
                        .shadow(color: theme.hearth.opacity(0.3), radius: 10, y: 6)
                    Text("🏠")
                        .font(.system(size: 44))
                }
                .padding(.bottom, 28)

                Text("Hearthstone")
                    .font(Theme.heading(32))
                    .foregroundColor(theme.charcoal)
                    .padding(.bottom, 10)

                Text("Your household knowledge, always at hand for the people who need it.")
                    .font(.system(size: 16))
                    .foregroundColor(theme.charcoalSoft)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.horizontal, 40)
                    .padding(.bottom, 48)

                HearthTextField(
                    label: "Email",
                    placeholder: "you@example.com",
                    text: $viewModel.email,
                    keyboardType: .emailAddress,
                    autocapitalization: .never
                )
                .padding(.horizontal, 32)
                .padding(.bottom, 16)

                if let error = viewModel.error {
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundColor(theme.rose)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                        .padding(.bottom, 12)
                }

                HearthButton(title: "Continue", isLoading: viewModel.isLoading) {
                    Task { await viewModel.sendCode() }
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 20)

                Text("We'll send a verification code to your email.\nNo password needed — ever.")
                    .font(.system(size: 12))
                    .foregroundColor(theme.stone)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)

                Spacer()
            }
        }
    }
}

#Preview {
    WelcomeView(viewModel: AuthViewModel())
}
