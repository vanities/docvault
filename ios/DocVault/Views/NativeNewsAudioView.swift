import AVFoundation
import SwiftUI

@Observable @MainActor private final class NewsAudioPlayer {
    var player: AVAudioPlayer?
    var playing = false
    var position = 0.0
    var duration = 0.0
    var rate: Float = 1
    var error: String?
    func load(_ url: URL) throws {
        stop()
        let player = try AVAudioPlayer(contentsOf: url)
        player.enableRate = true
        guard player.prepareToPlay() else { throw VaultError.server("The saved narration could not be decoded.") }
        self.player = player; duration = player.duration; position = 0
    }

    func toggle() {
        guard let player else { return }
        if player.isPlaying {
            pause()
        } else {
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .spokenAudio)
                try session.setActive(true)
                if player.currentTime >= player.duration {
                    player.currentTime = 0
                }
                player.rate = rate
                guard player.play() else { throw VaultError.server("Playback could not start.") }
                playing = true; error = nil
            } catch { self.error = error.localizedDescription }
        }
    }

    func pause() {
        player?.pause(); playing = false; try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func seek(_ seconds: Double) {
        player?.currentTime = min(duration, max(0, seconds)); position = player?.currentTime ?? 0
    }

    func stop() {
        pause(); player?.stop(); player = nil; position = 0; duration = 0
    }

    func tick() {
        position = player?.currentTime ?? 0; playing = player?.isPlaying ?? false
    }
}

struct NativeNewsAudioView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var textSize
    let record: VaultValue
    @State private var audio = NewsAudioPlayer()
    @State private var localURL: URL?
    @State private var loading = false
    @State private var generation = UUID()
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Saved narration").font(.headline)
            if localURL == nil {
                Button("Load narration", systemImage: "waveform") { Task { await load() } }.accessibilityIdentifier("newsLoadAudio").disabled(loading)
            } else {
                HStack {
                    Button { audio.seek(audio.position - 15) } label: { Image(systemName: "gobackward.15") }.accessibilityLabel("Back 15 seconds")
                    Spacer()
                    Button { audio.toggle() } label: {
                        if textSize.isAccessibilitySize {
                            Image(systemName: audio.playing ? "pause.fill" : "play.fill")
                        } else {
                            Label(audio.playing ? "Pause" : "Play", systemImage: audio.playing ? "pause.fill" : "play.fill")
                        }
                    }.accessibilityLabel(audio.playing ? "Pause narration" : "Play narration").accessibilityIdentifier("newsAudioPlayback")
                    Spacer()
                    Button { audio.seek(audio.position + 15) } label: { Image(systemName: "goforward.15") }.accessibilityLabel("Forward 15 seconds")
                }.buttonStyle(.bordered)
                if audio.duration > 0 {
                    Slider(value: Binding(get: { audio.position }, set: { audio.seek($0) }), in: 0 ... audio.duration).accessibilityLabel("Narration position")
                    Text(time(audio.position) + " / " + time(audio.duration)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                Picker("Playback speed", selection: $audio.rate) { ForEach([Float(0.75), 1, 1.25, 1.5, 2], id: \.self) { Text($0.formatted() + "×").tag($0) } }.pickerStyle(.menu).accessibilityIdentifier("newsAudioRate")
                    .onChange(of: audio.rate) { _, value in audio.player?.rate = value }
            }
            if loading {
                ProgressView("Downloading protected narration…")
            }
            if let error = audio.error {
                ErrorNotice(message: error)
            }
        }
        .task {
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(500)) } catch { return }; audio.tick()
            }
        }
        .onChange(of: scenePhase) {
            _, value in if value != .active {
                audio.pause()
            }
        }
        .onChange(of: model.unlocked) {
            _, value in if !value {
                audio.pause()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { _ in audio.pause() }
        .onDisappear {
            generation = UUID(); audio.stop(); if let localURL {
                VaultModel.removePreview(localURL)
            }; localURL = nil
        }
    }

    private func time(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0, seconds < Double(Int.max) else { return "—" }; let value = Int(seconds); return String(format: "%d:%02d", value / 60, value % 60)
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; audio.error = nil; defer {
            if generation == id {
                loading = false
            }
        }
        do {
            let suffix = record["audioPath"].string.lowercased().hasSuffix(".wav") ? "wav" : "mp3"
            let url = try await model.nativeDownload("api/daily-news/{id}/audio", scope: .init(), record: record, method: "GET", body: nil, suffix: suffix)
            guard generation == id, !Task.isCancelled else { VaultModel.removePreview(url); return }
            do {
                try audio.load(url); if let localURL {
                    VaultModel.removePreview(localURL)
                }; localURL = url
            } catch { VaultModel.removePreview(url); throw error }
        } catch {
            if generation == id, !Task.isCancelled {
                audio.error = error.localizedDescription
            }
        }
    }
}
