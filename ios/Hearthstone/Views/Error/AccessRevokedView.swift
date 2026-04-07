import SwiftUI

struct AccessRevokedView: View {
    let householdName: String

    var body: some View {
        VStack(spacing: 0) {
            // Dark header
            VStack(alignment: .leading, spacing: 2) {
                Text(householdName.isEmpty ? "Household" : householdName)
                    .font(Theme.heading(20))
                Text("Guest Access")
                    .font(.system(size: 13))
                    .opacity(0.7)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
            .foregroundColor(.white)
            .background(
                LinearGradient(colors: [Color(red: 139/255, green: 123/255, blue: 107/255), Color(red: 107/255, green: 93/255, blue: 80/255)], startPoint: .topLeading, endPoint: .bottomTrailing)
            )

            // Body
            VStack(spacing: 0) {
                Spacer()

                Circle()
                    .fill(Color(red: 240/255, green: 237/255, blue: 237/255))
                    .frame(width: 72, height: 72)
                    .overlay(Text("🔒").font(.system(size: 32)))
                    .padding(.bottom, 24)

                Text("Your access has been revoked")
                    .font(Theme.heading(22))
                    .foregroundColor(Theme.charcoal)
                    .padding(.bottom, 10)

                Text("The homeowner has removed your access to this household's information.")
                    .font(.system(size: 15))
                    .foregroundColor(Theme.charcoalSoft)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.horizontal, 40)
                    .padding(.bottom, 36)

                Text("If you think this is a mistake, contact the homeowner to request a new invite.")
                    .font(.system(size: 13))
                    .foregroundColor(Theme.stone)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .frame(maxWidth: 280)
                    .background(Theme.creamWarm)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))

                Spacer()
                Spacer()
            }
            .frame(maxWidth: .infinity)
        }
        .background(Theme.cream)
    }
}
