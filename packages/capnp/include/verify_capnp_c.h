#ifndef VERIFY_CAPNP_C_H
#define VERIFY_CAPNP_C_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum verify_data_kind {
  VERIFY_DATA_DG1 = 0,
  VERIFY_DATA_DG2 = 1,
  VERIFY_DATA_SOD = 2,
  VERIFY_DATA_SELFIE = 3,
  VERIFY_DATA_DG14 = 4,
  VERIFY_DATA_DG15 = 5,
  VERIFY_DATA_ACTIVE_AUTH = 6,
  VERIFY_DATA_CHIP_AUTH = 7,
  VERIFY_DATA_LIVENESS_VIDEO = 8
} verify_data_kind_t;

typedef enum verify_server_message_kind {
  VERIFY_SERVER_MESSAGE_NONE = 0,
  VERIFY_SERVER_MESSAGE_ACK = 1,
  VERIFY_SERVER_MESSAGE_ERROR = 2,
  VERIFY_SERVER_MESSAGE_CHECK_RESULT = 3,
  VERIFY_SERVER_MESSAGE_SHARE_REQUEST = 4,
  VERIFY_SERVER_MESSAGE_SHARE_READY = 5,
  VERIFY_SERVER_MESSAGE_ACTIVE_AUTH_CHALLENGE = 6,
  VERIFY_SERVER_MESSAGE_LIVENESS_CHALLENGE = 7
} verify_server_message_kind_t;

typedef enum verify_server_check_outcome {
  VERIFY_SERVER_CHECK_CONFIRMED = 0,
  VERIFY_SERVER_CHECK_NOT_CONFIRMED = 1
} verify_server_check_outcome_t;

typedef enum verify_server_check_kind {
  VERIFY_SERVER_CHECK_KIND_MRZ = 0,
  VERIFY_SERVER_CHECK_KIND_NFC = 1,
  VERIFY_SERVER_CHECK_KIND_LIVENESS = 2,
  VERIFY_SERVER_CHECK_KIND_NONE = 3
} verify_server_check_kind_t;

// The builder and reader pointers are opaque pointers from CapnpCLib:
// - capnp_c_message_builder_get()
// - capnp_c_message_reader_get()

int verify_build_hello(
  void* message_builder,
  const char* session_id,
  const char* mobile_write_token,
  const char* device_id,
  const char* app_version,
  const char* attest_key_id,
  const uint8_t* hello_assertion,
  size_t hello_assertion_size,
  uint32_t runtime_integrity_signal
);

int verify_build_phase(
  void* message_builder,
  const char* phase,
  const char* error,
  const uint8_t* attest_assertion,
  size_t attest_assertion_size
);

int verify_build_data(
  void* message_builder,
  int data_kind,
  const uint8_t* raw,
  size_t raw_size,
  uint32_t index,
  uint32_t total,
  uint32_t chunk_index,
  uint32_t chunk_total
);

int verify_build_share_selection(
  void* message_builder,
  const char* session_id,
  const char* const* selected_field_keys,
  size_t selected_field_key_count
);

verify_server_message_kind_t verify_server_message_kind(void* message_reader);

int verify_server_message_get_ack(
  void* message_reader,
  char* out_message,
  size_t out_message_size
);

int verify_server_message_get_error(
  void* message_reader,
  char* out_code,
  size_t out_code_size,
  char* out_message,
  size_t out_message_size
);

int verify_server_message_get_check_result(
  void* message_reader,
  int* out_outcome,
  char* out_reason_code,
  size_t out_reason_code_size,
  char* out_reason_message,
  size_t out_reason_message_size,
  int* out_retry_allowed,
  int* out_failed_check,
  uint32_t* out_remaining_nfc_retries,
  uint32_t* out_remaining_liveness_retries
);

int verify_server_message_get_share_request(
  void* message_reader,
  uint32_t* out_contract_version,
  char* out_session_id,
  size_t out_session_id_size,
  uint32_t* out_field_count
);

int verify_server_message_get_share_request_field(
  void* message_reader,
  uint32_t field_index,
  char* out_key,
  size_t out_key_size,
  char* out_reason,
  size_t out_reason_size,
  int* out_required
);

int verify_server_message_get_share_ready(
  void* message_reader,
  char* out_session_id,
  size_t out_session_id_size,
  uint32_t* out_field_count
);

int verify_server_message_get_share_ready_field(
  void* message_reader,
  uint32_t field_index,
  char* out_key,
  size_t out_key_size
);

int verify_server_message_get_active_auth_challenge(
  void* message_reader,
  uint8_t* out_challenge,
  size_t out_challenge_size,
  size_t* out_challenge_length
);

// Liveness challenge: maxDurationMs, challengeNonce. Earlier versions
// also returned a server-issued pose sequence; that was dropped because
// the v2 liveness flow derives pose from frames server-side.
int verify_server_message_get_liveness_challenge(
  void* message_reader,
  uint32_t* out_max_duration_ms,
  uint8_t* out_challenge_nonce,
  size_t out_challenge_nonce_size,
  size_t* out_challenge_nonce_length
);

#ifdef __cplusplus
}
#endif

#endif // VERIFY_CAPNP_C_H
