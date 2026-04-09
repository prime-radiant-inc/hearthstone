// Theme.swift
// Hearthstone
//
// Warm amber/sienna design system — light and dark mode

import SwiftUI

struct ResolvedTheme {
    let scheme: ColorScheme

    // MARK: - Backgrounds

    var cream: Color {
        scheme == .dark
            ? Color(red: 30/255, green: 26/255, blue: 22/255)
            : Color(red: 251/255, green: 247/255, blue: 240/255)
    }

    var creamWarm: Color {
        scheme == .dark
            ? Color(red: 42/255, green: 36/255, blue: 32/255)
            : Color(red: 245/255, green: 237/255, blue: 224/255)
    }

    var creamDeep: Color {
        scheme == .dark
            ? Color(red: 61/255, green: 53/255, blue: 41/255)
            : Color(red: 237/255, green: 227/255, blue: 209/255)
    }

    // MARK: - Text

    var charcoal: Color {
        scheme == .dark
            ? Color(red: 232/255, green: 223/255, blue: 212/255)
            : Color(red: 44/255, green: 37/255, blue: 32/255)
    }

    var charcoalSoft: Color {
        scheme == .dark
            ? Color(red: 181/255, green: 168/255, blue: 153/255)
            : Color(red: 92/255, green: 82/255, blue: 74/255)
    }

    var stone: Color {
        scheme == .dark
            ? Color(red: 122/255, green: 113/255, blue: 100/255)
            : Color(red: 155/255, green: 142/255, blue: 130/255)
    }

    // MARK: - Brand

    var hearth: Color {
        scheme == .dark
            ? Color(red: 200/255, green: 131/255, blue: 58/255)
            : Color(red: 181/255, green: 113/255, blue: 45/255)
    }

    var hearthDark: Color {
        scheme == .dark
            ? Color(red: 181/255, green: 113/255, blue: 45/255)
            : Color(red: 139/255, green: 90/255, blue: 30/255)
    }

    // MARK: - Status

    var sage: Color {
        Color(red: 122/255, green: 139/255, blue: 111/255)
    }

    var sageLight: Color {
        scheme == .dark
            ? Color(red: 45/255, green: 58/255, blue: 40/255)
            : Color(red: 232/255, green: 237/255, blue: 228/255)
    }

    var rose: Color {
        Color(red: 196/255, green: 107/255, blue: 90/255)
    }

    var roseLight: Color {
        scheme == .dark
            ? Color(red: 58/255, green: 36/255, blue: 32/255)
            : Color(red: 242/255, green: 224/255, blue: 220/255)
    }

    // MARK: - Badges

    var goldBadge: Color {
        scheme == .dark
            ? Color(red: 58/255, green: 52/255, blue: 36/255)
            : Color(red: 240/255, green: 229/255, blue: 200/255)
    }

    var goldBadgeText: Color {
        scheme == .dark
            ? Color(red: 181/255, green: 157/255, blue: 82/255)
            : Color(red: 139/255, green: 105/255, blue: 20/255)
    }

    var greenBadge: Color {
        scheme == .dark
            ? Color(red: 40/255, green: 48/255, blue: 37/255)
            : Color(red: 215/255, green: 232/255, blue: 208/255)
    }

    var greenBadgeText: Color {
        scheme == .dark
            ? Color(red: 122/255, green: 155/255, blue: 111/255)
            : Color(red: 61/255, green: 107/255, blue: 46/255)
    }

    var grayBadge: Color {
        scheme == .dark
            ? Color(red: 42/255, green: 40/255, blue: 38/255)
            : Color(red: 236/255, green: 234/255, blue: 231/255)
    }

    var grayBadgeText: Color {
        scheme == .dark
            ? Color(red: 138/255, green: 132/255, blue: 128/255)
            : Color(red: 123/255, green: 117/255, blue: 112/255)
    }

    // MARK: - Sidebar (constant dark in both modes)

    var sidebarBackground: Color {
        Color(red: 0.17, green: 0.14, blue: 0.13)
    }

    var sidebarSurface: Color {
        Color(red: 0.24, green: 0.20, blue: 0.18)
    }

    var sidebarText: Color {
        Color(red: 0.94, green: 0.90, blue: 0.83)
    }

    var sidebarTextMuted: Color {
        Color(red: 0.61, green: 0.56, blue: 0.51)
    }

    var sidebarTextInactive: Color {
        Color(red: 0.83, green: 0.77, blue: 0.66)
    }

    var sidebarAccent: Color {
        Color(red: 0.71, green: 0.44, blue: 0.18)
    }

    var sidebarDivider: Color {
        Color(red: 0.24, green: 0.20, blue: 0.18)
    }

    // MARK: - Derived convenience colors

    var iconBackgroundWarm: Color {
        scheme == .dark
            ? Color(red: 58/255, green: 48/255, blue: 36/255)
            : Color(red: 255/255, green: 243/255, blue: 220/255)
    }

    var iconBackgroundCool: Color {
        scheme == .dark
            ? Color(red: 45/255, green: 40/255, blue: 55/255)
            : Color(red: 232/255, green: 227/255, blue: 240/255)
    }

    var onboardingGradientStart: Color {
        scheme == .dark ? goldBadge : Color(red: 1.0, green: 0.988, blue: 0.945)
    }

    var onboardingGradientEnd: Color {
        scheme == .dark ? goldBadge : Color(red: 1.0, green: 0.973, blue: 0.902)
    }

    var connectedBannerStart: Color {
        scheme == .dark ? goldBadge : Color(red: 1, green: 0.99, blue: 0.95)
    }

    var connectedBannerEnd: Color {
        scheme == .dark ? goldBadge : Color(red: 1, green: 0.97, blue: 0.9)
    }

    var previewBannerStart: Color {
        Color(red: 92/255, green: 82/255, blue: 74/255)
    }

    var previewBannerEnd: Color {
        Color(red: 61/255, green: 53/255, blue: 48/255)
    }

    var revokedHeaderStart: Color {
        Color(red: 139/255, green: 123/255, blue: 107/255)
    }

    var revokedHeaderEnd: Color {
        Color(red: 107/255, green: 93/255, blue: 80/255)
    }

    var revokedIconCircle: Color {
        scheme == .dark
            ? Color(red: 50/255, green: 47/255, blue: 45/255)
            : Color(red: 240/255, green: 237/255, blue: 237/255)
    }

    var shadow: Color {
        scheme == .dark
            ? Color.black.opacity(0.3)
            : Color(red: 44/255, green: 37/255, blue: 32/255).opacity(0.08)
    }

    var shadowLight: Color {
        scheme == .dark
            ? Color.black.opacity(0.2)
            : Color(red: 44/255, green: 37/255, blue: 32/255).opacity(0.06)
    }
}

// MARK: - Theme namespace (static utilities + resolver)

enum Theme {
    static func resolved(for scheme: ColorScheme) -> ResolvedTheme {
        ResolvedTheme(scheme: scheme)
    }

    // Typography — system serif as Fraunces fallback
    static func heading(_ size: CGFloat) -> Font {
        .system(size: size, weight: .medium, design: .serif)
    }

    // Radii
    static let radiusLarge: CGFloat = 16
    static let radiusMedium: CGFloat = 10
    static let radiusSmall: CGFloat = 6
}
