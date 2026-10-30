import Foundation
import AVFoundation
import Vision
import AppKit
// frames <url> <start> <end> <step> : prints "t\tactual\ttext|..." per sampled frame (bottom 40% of the picture, Vision OCR).
let a = CommandLine.arguments
guard a.count >= 5, let url = URL(string: a[1]), let start = Double(a[2]), let end = Double(a[3]), let step = Double(a[4]) else { print("usage"); exit(1) }
let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": ["User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"]])
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = CMTime(seconds: 0.4, preferredTimescale: 600)
gen.requestedTimeToleranceAfter = CMTime(seconds: 0.4, preferredTimescale: 600)
var t = start
let out = FileHandle.standardOutput
while t < end {
  var actual = CMTime.zero
  do {
    let cg = try gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: &actual)
    let h = cg.height, w = cg.width
    let y = Int(Double(h) * 0.60)
    guard let crop = cg.cropping(to: CGRect(x: 0, y: y, width: w, height: h - y)) else { t += step; continue }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    request.minimumTextHeight = 0.02
    try VNImageRequestHandler(cgImage: crop, options: [:]).perform([request])
    let lines = (request.results ?? []).compactMap { r -> String? in
      guard let c = r.topCandidates(1).first else { return nil }
      let b = r.boundingBox
      return "\(c.string)@\(Int(b.minX*1000)),\(Int(b.minY*1000)),\(Int(b.width*1000))"
    }
    out.write("\(Int(t))\t\(String(format: "%.1f", actual.seconds))\t\(lines.joined(separator: " | "))\n".data(using: .utf8)!)
  } catch {
    out.write("\(Int(t))\tERR\t\(error.localizedDescription)\n".data(using: .utf8)!)
  }
  t += step
}
