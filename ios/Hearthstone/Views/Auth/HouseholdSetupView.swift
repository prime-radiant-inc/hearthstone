import SwiftUI

struct HouseholdSetupView: View {
    @ObservedObject var viewModel: AuthViewModel

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ProgressDots(active: 2, total: 3)
                .padding(.bottom, 36)

            Text("Welcome")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(theme.hearth)
                .padding(.bottom, 8)

            Text("Name your household")
                .font(Theme.heading(28))
                .foregroundColor(theme.charcoal)
                .lineLimit(2)
                .padding(.bottom, 10)

            Text("This is what your guests will see when they open the app. You can change it anytime.")
                .font(.system(size: 15))
                .foregroundColor(theme.charcoalSoft)
                .lineSpacing(4)
                .padding(.bottom, 40)

            HearthTextField(
                label: "Household Name",
                placeholder: "The Anderson Home",
                text: $viewModel.householdName
            )
            .padding(.bottom, 8)

            Text("e.g. \"The Anderson Home\", \"123 Oak Street\", \"Beach House\"")
                .font(.system(size: 13))
                .foregroundColor(theme.stone)
                .padding(.bottom, 24)

            if let error = viewModel.error {
                Text(error)
                    .font(.system(size: 14))
                    .foregroundColor(theme.rose)
                    .padding(.bottom, 12)
            }

            Spacer()
            Text("🏡")
                .font(.system(size: 64))
                .opacity(0.6)
                .frame(maxWidth: .infinity, alignment: .center)
            Spacer()

            HearthButton(title: "Continue", isLoading: viewModel.isLoading) {
                Task { await viewModel.createHousehold() }
            }
            .padding(.bottom, 34)
        }
        .padding(.horizontal, 24)
        .padding(.top, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.cream.ignoresSafeArea())
    }
}

#Preview {
    HouseholdSetupView(viewModel: AuthViewModel())
}
