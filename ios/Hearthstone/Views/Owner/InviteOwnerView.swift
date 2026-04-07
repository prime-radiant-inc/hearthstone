import SwiftUI

struct InviteOwnerView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var email = ""
    @State private var isLoading = false
    @State private var error: String?
    @State private var resultPin: String?
    @State private var resultExpiry: String?

    var body: some View {
        ZStack {
            Theme.cream.ignoresSafeArea()

            if let pin = resultPin, let expiry = resultExpiry {
                GuestPINView(
                    guestName: name,
                    pin: pin,
                    expiresAt: expiry
                ) {
                    dismiss()
                }
            } else {
                formView
            }
        }
    }

    private var formView: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Invite Owner")
                    .font(Theme.heading(22))
                    .foregroundColor(Theme.charcoal)

                Spacer()

                Button("Cancel") { dismiss() }
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(Theme.hearth)
            }
            .padding(.horizontal, 24)
            .padding(.top, 28)
            .padding(.bottom, 24)

            Divider()
                .background(Theme.creamDeep)

            ScrollView {
                VStack(spacing: 20) {
                    HearthTextField(
                        label: "Name",
                        placeholder: "e.g. Jamie",
                        text: $name
                    )

                    HearthTextField(
                        label: "Email",
                        placeholder: "jamie@example.com",
                        text: $email,
                        keyboardType: .emailAddress,
                        autocapitalization: .never
                    )

                    if let error {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundColor(Theme.rose)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    HearthButton(title: "Create Invite", isLoading: isLoading) {
                        Task { await inviteOwner() }
                    }
                    .padding(.top, 4)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 24)
            }
        }
    }

    private func inviteOwner() async {
        error = nil
        guard !email.trimmingCharacters(in: .whitespaces).isEmpty else {
            error = "Email is required."
            return
        }
        isLoading = true
        do {
            let response = try await APIClient.shared.inviteOwner(
                name: name.trimmingCharacters(in: .whitespaces),
                email: email.trimmingCharacters(in: .whitespaces)
            )
            resultPin = response.pin
            resultExpiry = response.expiresAt
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
