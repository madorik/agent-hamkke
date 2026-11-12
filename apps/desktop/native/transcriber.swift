// 회의 받아쓰기(macOS): 표준 입력으로 받은 소리(16kHz·모노·16비트 PCM)를 이 Mac 안에서 글로 바꿔 줄 단위 JSON 으로 내보낸다.
// 앱(메인 프로세스)이 띄운다. 소리는 이 Mac 밖으로 나가지 않는다(기기 안 인식을 지원하는 언어면).
//
// 사용: transcriber [ko-KR|en-US]
// 출력(stdout, 한 줄에 하나):
//   {"type":"ready","onDevice":true}
//   {"type":"partial","text":"지금 듣는 중인 문장"}
//   {"type":"final","text":"끝난 문장들","start":12.5}        // start: 녹음 시작부터 초
//   {"type":"error","code":"denied|restricted|unavailable|dictation","message":"..."}
//     dictation: 시스템 설정의 받아쓰기(Dictation)가 꺼져 있어 인식이 안 된다(녹음은 계속된다)
//   {"type":"done"}                                          // 입력이 끝나 남은 글을 다 내보냄
//
// 음성 인식 한 번에 넣을 수 있는 소리는 1분쯤이라, 50초가 넘으면 말이 잠깐 멈춘 곳에서 끊어 새로 이어 받는다.
import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

let SAMPLE_RATE = 16000.0
let SEGMENT_SOFT = 50.0 // 이만큼 지나면 다음 쉼에서 끊는다
let SEGMENT_HARD = 58.0 // 쉼이 없어도 여기서는 끊는다
let PAUSE_RMS: Float = 0.01
let PAUSE_SECONDS = 0.5

func emit(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) else { return }
  print(s)
}

let localeId = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "ko-KR"
guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)), recognizer.isAvailable else {
  emit(["type": "error", "code": "unavailable", "message": "speech recognizer for \(localeId) is not available"])
  exit(3)
}
let onDevice = recognizer.supportsOnDeviceRecognition
let format = AVAudioFormat(standardFormatWithSampleRate: SAMPLE_RATE, channels: 1)!

/// 끊어서 받는 한 토막
final class Segment {
  let index: Int
  let start: Double
  let request = SFSpeechAudioBufferRecognitionRequest()
  var task: SFSpeechRecognitionTask?
  var seconds = 0.0
  var text = ""
  var finished = false
  init(index: Int, start: Double) {
    self.index = index
    self.start = start
    request.shouldReportPartialResults = true
    request.requiresOnDeviceRecognition = onDevice
    if #available(macOS 13, *) { request.addsPunctuation = true }
  }
}

let lock = NSLock()
var segments: [Segment] = []
var current: Segment?
var nextToEmit = 0
var totalSeconds = 0.0
var quietSeconds = 0.0
var inputEnded = false
var dictationReported = false

/// 끝난 토막을 순서대로 내보낸다
func flushFinished() {
  while nextToEmit < segments.count, segments[nextToEmit].finished {
    let s = segments[nextToEmit]
    let text = s.text.trimmingCharacters(in: .whitespacesAndNewlines)
    if !text.isEmpty { emit(["type": "final", "text": text, "start": (s.start * 10).rounded() / 10]) }
    nextToEmit += 1
  }
  if inputEnded && nextToEmit == segments.count {
    emit(["type": "done"])
    exit(0)
  }
}

func startSegment() -> Segment {
  let s = Segment(index: segments.count, start: totalSeconds)
  segments.append(s)
  s.task = recognizer.recognitionTask(with: s.request) { result, error in
    lock.lock()
    defer { lock.unlock() }
    if let result = result {
      s.text = result.bestTranscription.formattedString
      if !result.isFinal && current === s { emit(["type": "partial", "text": s.text]) }
      if result.isFinal { s.finished = true }
    }
    // 말이 없던 토막은 오류(인식된 말 없음)로 끝난다. 글이 없는 것으로 친다.
    if let error = error {
      if s.text.isEmpty { FileHandle.standardError.write("segment \(s.index): \(error.localizedDescription)\n".data(using: .utf8)!) }
      // 받아쓰기(Dictation)가 꺼져 있으면 음성 인식이 아예 안 된다. 한 번만 알린다(앱이 켜는 방법을 안내한다)
      if !dictationReported, error.localizedDescription.range(of: "Dictation", options: .caseInsensitive) != nil {
        dictationReported = true
        emit(["type": "error", "code": "dictation", "message": error.localizedDescription])
      }
      s.finished = true
    }
    if s.finished { flushFinished() }
  }
  return s
}

func endSegment(_ s: Segment) {
  s.request.endAudio()
}

/// 16비트 PCM 조각을 받아 지금 토막에 넣는다
func feed(_ data: Data) {
  let count = data.count / 2
  guard count > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)) else { return }
  buffer.frameLength = AVAudioFrameCount(count)
  let out = buffer.floatChannelData![0]
  var sum: Float = 0
  data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
    let samples = raw.bindMemory(to: Int16.self)
    for i in 0..<count {
      let v = Float(Int16(littleEndian: samples[i])) / 32768
      out[i] = v
      sum += v * v
    }
  }
  let rms = sqrt(sum / Float(count))
  let seconds = Double(count) / SAMPLE_RATE

  lock.lock()
  defer { lock.unlock() }
  let s = current ?? startSegment()
  current = s
  s.request.append(buffer)
  s.seconds += seconds
  totalSeconds += seconds
  quietSeconds = rms < PAUSE_RMS ? quietSeconds + seconds : 0
  if s.seconds >= SEGMENT_HARD || (s.seconds >= SEGMENT_SOFT && quietSeconds >= PAUSE_SECONDS) {
    endSegment(s)
    current = startSegment()
  }
}

func readInput() {
  let input = FileHandle.standardInput
  // 한꺼번에 많이 들어와도(파일 등) 0.5초씩 나눠 넣어야 토막을 제때 끊는다
  let piece = Int(SAMPLE_RATE / 2) * 2
  var rest = Data()
  while true {
    let data = input.availableData
    if data.isEmpty { break }
    rest.append(data)
    while rest.count >= piece {
      feed(rest.prefix(piece))
      rest.removeFirst(piece)
    }
  }
  if rest.count >= 2 { feed(rest.prefix(rest.count - rest.count % 2)) }
  lock.lock()
  inputEnded = true
  if let s = current { endSegment(s) }
  current = nil
  flushFinished()
  lock.unlock()
}

SFSpeechRecognizer.requestAuthorization { status in
  switch status {
  case .authorized:
    emit(["type": "ready", "onDevice": onDevice])
    DispatchQueue.global(qos: .userInitiated).async { readInput() }
  case .denied:
    emit(["type": "error", "code": "denied", "message": "speech recognition permission denied"])
    exit(2)
  case .restricted:
    emit(["type": "error", "code": "restricted", "message": "speech recognition is restricted on this Mac"])
    exit(2)
  default:
    emit(["type": "error", "code": "denied", "message": "speech recognition permission not determined"])
    exit(2)
  }
}

RunLoop.main.run()
