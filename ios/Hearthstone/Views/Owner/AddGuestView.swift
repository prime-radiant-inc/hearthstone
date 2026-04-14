import SwiftUI

struct AddGuestView: View {
    var onSuccess: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    @State private var name = ""
    @State private var email = ""
    @State private var isLoading = false
    @State private var error: String?
    @State private var createdGuest: APIClient.CreateGuestResponse?

    var body: some View {
        ZStack {
            theme.cream.ignoresSafeArea()

            if let guest = createdGuest, let joinURL = URL(string: guest.joinUrl) {
                GuestPINView(
                    guestName: guest.guest.name,
                    pin: guest.pin,
                    joinURL: joinURL,
                    expiresAt: guest.expiresAt
                ) {
                    onSuccess()
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
                Text("Add Guest")
                    .font(Theme.heading(22))
                    .foregroundColor(theme.charcoal)

                Spacer()

                Button("Cancel") { dismiss() }
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(theme.hearth)
            }
            .padding(.horizontal, 24)
            .padding(.top, 28)
            .padding(.bottom, 24)

            Divider()
                .background(theme.creamDeep)

            ScrollView {
                VStack(spacing: 20) {
                    HearthTextField(
                        label: "Name",
                        placeholder: "e.g. Maria Santos",
                        text: $name
                    )

                    HearthTextField(
                        label: "Email (optional)",
                        placeholder: "maria@email.com",
                        text: $email,
                        keyboardType: .emailAddress,
                        autocapitalization: .never
                    )

                    if let error {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundColor(theme.rose)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    HearthButton(title: "Create Invite", isLoading: isLoading) {
                        Task { await createGuest() }
                    }
                    .padding(.top, 4)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 24)
            }
        }
    }

    private func createGuest() async {
        error = nil
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else {
            error = "Name is required."
            return
        }
        guard let client = SessionStore.shared.activeSession?.apiClient() else {
            error = "No active session."
            return
        }
        isLoading = true
        do {
            let response = try await client.createGuest(
                name: name.trimmingCharacters(in: .whitespaces),
                email: email.isEmpty ? nil : email.trimmingCharacters(in: .whitespaces)
            )
            createdGuest = response
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
