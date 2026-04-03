import SwiftUI

struct AddGuestView: View {
    var onSuccess: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var contactType: ContactType = .email
    @State private var contact = ""
    @State private var isLoading = false
    @State private var error: String?

    enum ContactType: String, CaseIterable {
        case email = "Email"
        case phone = "Phone"
    }

    var body: some View {
        ZStack {
            Theme.cream.ignoresSafeArea()

            VStack(spacing: 0) {
                // Sheet header
                HStack {
                    Text("Add Guest")
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
                        // Name field
                        HearthTextField(
                            label: "Name",
                            placeholder: "e.g. Maria Santos",
                            text: $name
                        )

                        // Contact type picker
                        VStack(alignment: .leading, spacing: 8) {
                            Text("SEND INVITE VIA")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(Theme.charcoalSoft)
                                .tracking(0.8)

                            HStack(spacing: 0) {
                                ForEach(ContactType.allCases, id: \.self) { type in
                                    Button(action: {
                                        contactType = type
                                        contact = ""
                                    }) {
                                        Text(type.rawValue)
                                            .font(.system(size: 15, weight: .semibold))
                                            .frame(maxWidth: .infinity)
                                            .padding(.vertical, 10)
                                            .background(
                                                contactType == type
                                                    ? LinearGradient(colors: [Theme.hearth, Theme.hearthDark],
                                                                     startPoint: .topLeading, endPoint: .bottomTrailing)
                                                    : LinearGradient(colors: [Color.white, Color.white],
                                                                     startPoint: .topLeading, endPoint: .bottomTrailing)
                                            )
                                            .foregroundColor(contactType == type ? .white : Theme.charcoalSoft)
                                    }
                                }
                            }
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.radiusMedium)
                                    .stroke(Theme.creamDeep, lineWidth: 1.5)
                            )
                        }

                        // Contact field (switches by picker)
                        if contactType == .email {
                            HearthTextField(
                                label: "Email Address",
                                placeholder: "maria@email.com",
                                text: $contact,
                                keyboardType: .emailAddress,
                                autocapitalization: .never
                            )
                        } else {
                            HearthTextField(
                                label: "Phone Number",
                                placeholder: "+1 555 000 0000",
                                text: $contact,
                                keyboardType: .phonePad
                            )
                        }

                        // Error
                        if let error {
                            Text(error)
                                .font(.system(size: 13))
                                .foregroundColor(Theme.rose)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        // Submit button
                        HearthButton(title: "Send Invite", isLoading: isLoading) {
                            Task { await sendInvite() }
                        }
                        .padding(.top, 4)
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 24)
                }
            }
        }
    }

    private func sendInvite() async {
        error = nil

        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else {
            error = "Name is required."
            return
        }
        guard !contact.trimmingCharacters(in: .whitespaces).isEmpty else {
            error = contactType == .email ? "Email address is required." : "Phone number is required."
            return
        }

        isLoading = true
        do {
            let email = contactType == .email ? contact : nil
            let phone = contactType == .phone ? contact : nil
            _ = try await APIClient.shared.createGuest(
                name: name.trimmingCharacters(in: .whitespaces),
                email: email,
                phone: phone
            )
            onSuccess()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

#Preview {
    AddGuestView(onSuccess: {})
}
