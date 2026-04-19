import Foundation

func shouldRequireAuthenticatedCancellation(payload: QRCodePayload?) -> Bool {
  payload != nil
}
