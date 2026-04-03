import SwiftUI

struct HouseholdSetupView: View {
    @ObservedObject var viewModel: AuthViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Progress dots (step 2 of 3)
            ProgressDots(active: 2, total: 3)
                .padding(.bottom, 36)

            // Subtitle
            Text("Welcome")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(Theme.hearth)
                .padding(.bottom, 8)

            // Heading
            Text("Name your household")
                .font(Theme.heading(28))
                .foregroundColor(Theme.charcoal)
                .lineLimit(2)
                .padding(.bottom, 10)

            // Description
            Text("This is what your guests will see when they open the app. You can change it anytime.")
                .font(.system(size: 15))
                .foregroundColor(Theme.charcoalSoft)
                .lineSpacing(4)
                .padding(.bottom, 40)

            // Household name field
            HearthTextField(
                label: "Household Name",
                placeholder: "The Anderson Home",
                text: $viewModel.householdName
            )
            .padding(.bottom, 8)

            // Hint
            Text("e.g. \"The Anderson Home\", \"123 Oak Street\", \"Beach House\"")
                .font(.system(size: 13))
                .foregroundColor(Theme.stone)
                .padding(.bottom, 24)

            // Error
            if let error = viewModel.error {
                Text(error)
                    .font(.system(size: 14))
                    .foregroundColor(Theme.rose)
                    .padding(.bottom, 12)
            }

            // Illustration
            Spacer()
            Text("🏡")
                .font(.system(size: 64))
                .opacity(0.6)
                .frame(maxWidth: .infinity, alignment: .center)
            Spacer()

            // Continue button
            HearthButton(title: "Continue", isLoading: viewModel.isLoading) {
                Task { await viewModel.createHousehold() }
            }
            .padding(.bottom, 34)
        }
        .padding(.horizontal, 24)
        .padding(.top, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.cream.ignoresSafeArea())
    }
}

#Preview {
    HouseholdSetupView(viewModel: AuthViewModel())
}
