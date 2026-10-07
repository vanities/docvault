import AVFoundation
import SwiftUI

struct NativeVoiceRecorder: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    var person: String?
    var transcript: ((String) -> Void)?
    @State private var recorder: AVAudioRecorder?
    @State private var url: URL?
    @State private var recording = false
    @State private var saving = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label(
                        recording ? "Recording…" : "Voice recording",
                        systemImage: recording ? "waveform" : "mic"
                    ).font(.title2)
                    Text(
                        person == nil
                            ? "Record a message and transcribe it through your configured server."
                            : "Record a sample for this person's voice profile."
                    ).foregroundStyle(.secondary)
                    if recording {
                        Button("Stop recording", role: .destructive) { stop() }
                    } else {
                        Button(url == nil ? "Start recording" : "Record again") {
                            Task { await start() }
                        }.disabled(saving)
                    }
                    if url != nil, !recording {
                        Button(person == nil ? "Transcribe message" : "Save voice clip") {
                            Task { await save() }
                        }.disabled(saving)
                    }
                    if saving {
                        ProgressView("Sending recording…")
                    }
                    if let error {
                        ErrorNotice(message: error)
                    }
                }
            }.navigationTitle("Record voice").toolbar {
                Button("Done") { dismiss() }.disabled(saving)
            }
            .onChange(of: scenePhase) {
                _, phase in if phase != .active {
                    stop()
                }
            }
            .onDisappear {
                stop()
                if let url {
                    VaultModel.removePreview(url)
                }
            }
        }
    }

    private func start() async {
        error = nil
        guard await AVAudioApplication.requestRecordPermission() else {
            error = "Enable microphone access in iOS Settings to record voice."
            return
        }
        do {
            if let url {
                VaultModel.removePreview(url)
            }
            let folder = VaultModel.previewRoot.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(
                at: folder, withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.complete]
            )
            let file = folder.appendingPathComponent("Voice.m4a")
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            let recorder = try AVAudioRecorder(
                url: file,
                settings: [
                    AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 24000,
                    AVNumberOfChannelsKey: 1,
                    AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
                ]
            )
            guard recorder.record(forDuration: 120) else {
                throw VaultError.server("Unable to start recording.")
            }
            self.recorder = recorder
            url = file
            recording = true
            Task {
                try? await Task.sleep(for: .seconds(120))
                if self.recorder === recorder {
                    stop()
                }
            }
        } catch { self.error = error.localizedDescription }
    }

    private func stop() {
        recorder?.stop()
        recorder = nil
        recording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func save() async {
        guard let url else { return }
        stop()
        saving = true
        error = nil
        defer { saving = false }
        do {
            if let person {
                _ = try await model.nativeUpload(
                    "api/health/{person}/voice/clips?filename={filename}",
                    scope: .init(person: person),
                    record: .object(["filename": .string("Voice.m4a")]), fileURL: url, method: "POST"
                )
            } else if model.demo {
                transcript?("Demo voice message")
            } else {
                guard let api = model.api else { throw VaultError.signedOut }
                let text = try await api.transcribe(Data(contentsOf: url))
                transcript?(text)
            }
            dismiss()
        } catch {
            model.handle(error)
            self.error = error.localizedDescription
        }
    }
}
