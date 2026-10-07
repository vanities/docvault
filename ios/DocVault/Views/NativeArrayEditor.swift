import SwiftUI

/// Whole-list editors retain hidden ids and fields so saving does not detach references.
struct NativeArrayEditor: View {
    let title: String
    let fields: [NativeField]
    @Binding var text: String
    @State private var rows: [VaultValue] = []
    @State private var error: String?
    var body: some View {
        Form {
            if let error {
                ErrorNotice(message: error)
            }
            ForEach(rows.indices, id: \.self) { index in
                Section("Item \(index + 1)") {
                    ForEach(fields) { field in
                        let binding = Binding(
                            get: { NativeForm.display(rows[index].at(field.id), field: field) },
                            set: { raw in
                                rows[index].set(
                                    field.id,
                                    (try? NativeForm.value(field: field, text: raw)) ?? .string(raw)
                                )
                                persist()
                            }
                        )
                        switch field.kind {
                        case .boolean:
                            Toggle(
                                field.label,
                                isOn: Binding(
                                    get: { binding.wrappedValue == "true" },
                                    set: { binding.wrappedValue = $0 ? "true" : "false" }
                                )
                            )
                        case let .choices(options):
                            Picker(field.label, selection: binding) {
                                if !field.required {
                                    Text("None").tag("")
                                }
                                ForEach(options, id: \.self) { Text(VaultValue.label($0)).tag($0) }
                            }
                        case .multiline, .strings:
                            VStack(alignment: .leading) {
                                Text(field.label)
                                TextEditor(text: binding).frame(minHeight: 90)
                            }
                        case .number, .integer, .percentage:
                            VStack(alignment: .leading, spacing: 7) {
                                Text(field.label).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                                TextField(field.label, text: binding).keyboardType(.numbersAndPunctuation)
                                    .accessibilityIdentifier("record-field-\(index)-" + field.id)
                            }
                        default:
                            VStack(alignment: .leading, spacing: 7) {
                                Text(field.label).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                                TextField(field.label, text: binding).accessibilityIdentifier("record-field-\(index)-" + field.id)
                            }
                        }
                    }
                    HStack {
                        if index > 0 {
                            Button("Move up") {
                                rows.swapAt(index, index - 1)
                                persist()
                            }
                        }
                        Spacer()
                        Button("Remove", role: .destructive) {
                            rows.remove(at: index)
                            persist()
                        }
                    }
                }
            }
            Button("Add item", systemImage: "plus") {
                var row = VaultValue.object([:])
                for field in fields {
                    if let value = try? NativeForm.value(field: field, text: field.initial) {
                        row.set(field.id, value)
                    }
                }
                rows.append(row)
                persist()
            }
        }.navigationTitle(title)
            .task {
                do {
                    rows = try JSONDecoder().decode([VaultValue].self, from: Data(text.utf8))
                } catch { self.error = error.localizedDescription }
            }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(rows) {
            text = String(decoding: data, as: UTF8.self)
        }
    }
}
