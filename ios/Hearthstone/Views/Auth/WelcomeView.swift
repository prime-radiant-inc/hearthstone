import SwiftUI

struct WelcomeView: View {
    @ObservedObject var viewModel: AuthViewModel

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Theme.cream, Theme.creamWarm],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Logo
                ZStack {
                    RoundedRectangle(cornerRadius: 24)
                        .fill(
                            LinearGradient(
                                colors: [Theme.hearth, Theme.hearthDark],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 88, height: 88)
                        .shadow(color: Theme.hearth.opacity(0.3), radius: 10, y: 6)
                    Text("🏠")
                        .font(.system(size: 44))
                }
                .padding(.bottom, 28)

                // Title
                Text("Hearthstone")
                    .font(Theme.heading(32))
                    .foregroundColor(Theme.charcoal)
                    .padding(.bottom, 10)

                // Tagline
                Text("Your household knowledge, always at hand for the people who need it.")
                    .font(.system(size: 16))
                    .foregroundColor(Theme.charcoalSoft)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.horizontal, 40)
                    .padding(.bottom, 48)

                // Email field
                HearthTextField(
                    label: "Email",
                    placeholder: "you@example.com",
                    text: $viewModel.email,
                    keyboardType: .emailAddress,
                    autocapitalization: .never
                )
                .padding(.horizontal, 32)
                .padding(.bottom, 16)

                // Error
                if let error = viewModel.error {
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundColor(Theme.rose)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                        .padding(.bottom, 12)
                }

                // Continue button
                HearthButton(title: "Continue", isLoading: viewModel.isLoading) {
                    Task { await viewModel.sendCode() }
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 20)

                // Legal
                Text("We'll send a verification code to your email.\nNo password needed — ever.")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.stone)
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
