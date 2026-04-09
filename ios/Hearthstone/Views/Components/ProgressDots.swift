import SwiftUI

struct ProgressDots: View {
    let active: Int
    let total: Int

    @Environment(\.colorScheme) private var colorScheme
    private var theme: ResolvedTheme { Theme.resolved(for: colorScheme) }

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<total, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2)
                    .fill(index < active ? theme.hearth : theme.creamDeep)
                    .frame(maxWidth: .infinity)
                    .frame(height: 4)
            }
        }
    }
}

#Preview {
    ProgressDots(active: 2, total: 3)
        .padding()
}
