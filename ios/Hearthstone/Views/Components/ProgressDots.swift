import SwiftUI

/// Horizontal progress indicator: filled dots for completed/current steps, muted for remaining.
struct ProgressDots: View {
    let active: Int
    let total: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<total, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2)
                    .fill(index < active ? Theme.hearth : Theme.creamDeep)
                    .frame(maxWidth: .infinity)
                    .frame(height: 4)
            }
        }
    }
}

#Preview {
    VStack(spacing: 16) {
        ProgressDots(active: 1, total: 3)
        ProgressDots(active: 2, total: 3)
        ProgressDots(active: 3, total: 3)
    }
    .padding()
    .background(Theme.cream)
}
