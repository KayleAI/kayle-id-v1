import importlib
import unittest
from unittest import mock

import numpy as np

with (
    mock.patch("builtins.print"),
    mock.patch("cv2.FaceDetectorYN.create", return_value=object()),
    mock.patch("cv2.FaceRecognizerSF.create", return_value=object()),
):
    service = importlib.import_module("service")


class BuildEmbeddingTests(unittest.TestCase):
    def test_build_embedding_requires_detected_face_crop(self) -> None:
        recognizer = mock.Mock()

        with mock.patch.object(service, "prepare_face_crop", return_value=None):
            result = service.build_embedding(
                object(),
                recognizer,
                np.zeros((8, 8, 3), dtype=np.uint8),
            )

        self.assertIsNone(result)
        recognizer.feature.assert_not_called()

    def test_build_embedding_falls_back_to_full_image_for_dg2_inputs(self) -> None:
        recognizer = mock.Mock()
        prepared = np.ones((112, 112, 3), dtype=np.uint8)
        embedding = np.array([0.1, 0.2, 0.3], dtype=np.float32)
        recognizer.feature.return_value = embedding

        with (
            mock.patch.object(service, "prepare_face_crop", return_value=None),
            mock.patch.object(
                service,
                "prepare_full_image_crop",
                return_value=prepared,
            ),
        ):
            result = service.build_embedding(
                object(),
                recognizer,
                np.zeros((8, 8, 3), dtype=np.uint8),
                allow_full_image_fallback=True,
            )

        self.assertTrue(np.array_equal(result, embedding))
        self.assertIsNot(result, embedding)
        recognizer.feature.assert_called_once_with(prepared)


class CompareFacesTests(unittest.TestCase):
    def test_compare_faces_falls_back_to_strict_image_similarity(self) -> None:
        recognizer = mock.Mock()

        with (
            mock.patch.object(service, "decode_selfie", side_effect=["s0", "s1", "s2"]),
            mock.patch.object(
                service,
                "build_embedding",
                side_effect=[None, None, None, None],
            ),
            mock.patch.object(
                service,
                "compute_image_similarity",
                side_effect=[1.0, 1.0, None],
            ),
        ):
            result = service.compare_faces(
                object(),
                recognizer,
                np.zeros((8, 8, 3), dtype=np.uint8),
                ["selfie-0", "selfie-1", "selfie-2"],
                0.95,
            )

        self.assertEqual(result["faceScore"], 1.0)
        self.assertTrue(result["passed"])
        self.assertTrue(result["usedFallback"])
        recognizer.match.assert_not_called()

    def test_compare_faces_uses_median_score_instead_of_best_selfie(self) -> None:
        recognizer = mock.Mock()
        recognizer.match.side_effect = [0.9, 0.1, 0.8]

        with (
            mock.patch.object(service, "decode_selfie", side_effect=["s0", "s1", "s2"]),
            mock.patch.object(
                service,
                "build_embedding",
                side_effect=[
                    "dg2-embedding",
                    "selfie-embedding-0",
                    "selfie-embedding-1",
                    "selfie-embedding-2",
                ],
            ),
        ):
            result = service.compare_faces(
                object(),
                recognizer,
                np.zeros((8, 8, 3), dtype=np.uint8),
                ["selfie-0", "selfie-1", "selfie-2"],
                0.93,
            )

        self.assertAlmostEqual(result["faceScore"], 0.9)
        self.assertFalse(result["passed"])
        self.assertFalse(result["usedFallback"])

    def test_compare_faces_requires_two_usable_selfies(self) -> None:
        recognizer = mock.Mock()
        recognizer.match.return_value = 0.9

        with (
            mock.patch.object(service, "decode_selfie", side_effect=["s0", "s1", "s2"]),
            mock.patch.object(
                service,
                "build_embedding",
                side_effect=[
                    "dg2-embedding",
                    "selfie-embedding-0",
                    None,
                    None,
                ],
            ),
            mock.patch.object(service, "compute_image_similarity", return_value=None),
            mock.patch.object(service, "emit_log"),
        ):
            result = service.compare_faces(
                object(),
                recognizer,
                np.zeros((8, 8, 3), dtype=np.uint8),
                ["selfie-0", "selfie-1", "selfie-2"],
                0.8,
            )

        self.assertIsNone(result["faceScore"])
        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "face_score_insufficient_usable_selfies")
        self.assertTrue(result["usedFallback"])
        recognizer.match.assert_called_once()

    def test_compare_faces_rejects_when_passport_face_is_not_detected(self) -> None:
        recognizer = mock.Mock()

        with (
            mock.patch.object(service, "decode_selfie", side_effect=["s0", "s1", "s2"]),
            mock.patch.object(
                service,
                "build_embedding",
                side_effect=[
                    None,
                    "selfie-embedding-0",
                    "selfie-embedding-1",
                    "selfie-embedding-2",
                ],
            ),
            mock.patch.object(service, "compute_image_similarity", return_value=None),
            mock.patch.object(service, "emit_log"),
        ):
            result = service.compare_faces(
                object(),
                recognizer,
                np.zeros((8, 8, 3), dtype=np.uint8),
                ["selfie-0", "selfie-1", "selfie-2"],
                0.8,
            )

        self.assertIsNone(result["faceScore"])
        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "face_score_dg2_face_not_detected")
        self.assertTrue(result["usedFallback"])
        recognizer.match.assert_not_called()


if __name__ == "__main__":
    unittest.main()
