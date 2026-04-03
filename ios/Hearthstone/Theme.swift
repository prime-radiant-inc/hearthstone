// Theme.swift
// Hearthstone
//
// Warm amber/sienna design system

import SwiftUI

enum Theme {
    // Colors — warm amber/sienna palette
    static let hearth = Color(red: 181/255, green: 113/255, blue: 45/255)
    static let hearthDark = Color(red: 139/255, green: 90/255, blue: 30/255)
    static let cream = Color(red: 251/255, green: 247/255, blue: 240/255)
    static let creamWarm = Color(red: 245/255, green: 237/255, blue: 224/255)
    static let creamDeep = Color(red: 237/255, green: 227/255, blue: 209/255)
    static let charcoal = Color(red: 44/255, green: 37/255, blue: 32/255)
    static let charcoalSoft = Color(red: 92/255, green: 82/255, blue: 74/255)
    static let stone = Color(red: 155/255, green: 142/255, blue: 130/255)
    static let sage = Color(red: 122/255, green: 139/255, blue: 111/255)
    static let sageLight = Color(red: 232/255, green: 237/255, blue: 228/255)
    static let rose = Color(red: 196/255, green: 107/255, blue: 90/255)
    static let roseLight = Color(red: 242/255, green: 224/255, blue: 220/255)
    static let goldBadge = Color(red: 240/255, green: 229/255, blue: 200/255)
    static let goldBadgeText = Color(red: 139/255, green: 105/255, blue: 20/255)
    static let greenBadge = Color(red: 215/255, green: 232/255, blue: 208/255)
    static let greenBadgeText = Color(red: 61/255, green: 107/255, blue: 46/255)
    static let grayBadge = Color(red: 236/255, green: 234/255, blue: 231/255)
    static let grayBadgeText = Color(red: 123/255, green: 117/255, blue: 112/255)

    // Typography — system serif as Fraunces fallback (Fraunces can be bundled later)
    static func heading(_ size: CGFloat) -> Font {
        .system(size: size, weight: .medium, design: .serif)
    }

    // Radii
    static let radiusLarge: CGFloat = 16
    static let radiusMedium: CGFloat = 10
    static let radiusSmall: CGFloat = 6
}
