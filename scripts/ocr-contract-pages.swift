import Foundation
import Vision
import AppKit
let paths=Array(CommandLine.arguments.dropFirst())
for path in paths {
 let url=URL(fileURLWithPath:path)
 let req=VNRecognizeTextRequest();req.recognitionLevel = .accurate;req.usesLanguageCorrection=false
 try VNImageRequestHandler(url:url).perform([req])
 let lines=(req.results ?? []).compactMap { obs -> [String:Any]? in
 guard let t=obs.topCandidates(1).first else{return nil};let b=obs.boundingBox
 return ["text":t.string,"box":[b.minX,1-b.maxY,b.maxX,1-b.minY]]
 }
 let data=try JSONSerialization.data(withJSONObject:lines)
 try data.write(to:URL(fileURLWithPath:path+".json"))
 print(url.lastPathComponent)
}
