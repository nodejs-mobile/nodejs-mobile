#include "crypto/crypto_dsa.h"
#include "crypto/crypto_keys.h"
#include "crypto/crypto_util.h"
#include "async_wrap-inl.h"
#include "env-inl.h"
#include "memory_tracker-inl.h"
#include "threadpoolwork-inl.h"
#include "v8.h"

#include <openssl/bn.h>
#include <openssl/dsa.h>

#include <cstdio>

namespace node {

using v8::FunctionCallbackInfo;
using v8::Int32;
using v8::Just;
using v8::Local;
using v8::Maybe;
using v8::Nothing;
using v8::Number;
using v8::Object;
using v8::Uint32;
using v8::Value;

namespace crypto {
EVPKeyCtxPointer DsaKeyGenTraits::Setup(DsaKeyPairGenConfig* params) {
  EVPKeyCtxPointer param_ctx(EVP_PKEY_CTX_new_id(EVP_PKEY_DSA, nullptr));
  EVP_PKEY* raw_params = nullptr;

  if (!param_ctx ||
      EVP_PKEY_paramgen_init(param_ctx.get()) <= 0 ||
      EVP_PKEY_CTX_set_dsa_paramgen_bits(
          param_ctx.get(),
          params->params.modulus_bits) <= 0) {
    return EVPKeyCtxPointer();
  }

  if (params->params.divisor_bits != -1) {
    if (EVP_PKEY_CTX_ctrl(
            param_ctx.get(),
            EVP_PKEY_DSA,
            EVP_PKEY_OP_PARAMGEN,
            EVP_PKEY_CTRL_DSA_PARAMGEN_Q_BITS,
            params->params.divisor_bits,
            nullptr) <= 0) {
      return EVPKeyCtxPointer();
    }
  }

  if (EVP_PKEY_paramgen(param_ctx.get(), &raw_params) <= 0)
    return EVPKeyCtxPointer();

  EVPKeyPointer key_params(raw_params);
  EVPKeyCtxPointer key_ctx(EVP_PKEY_CTX_new(key_params.get(), nullptr));

  if (!key_ctx || EVP_PKEY_keygen_init(key_ctx.get()) <= 0)
    return EVPKeyCtxPointer();

  return key_ctx;
}

// Input arguments for DsaKeyPairGenJob
//   1. CryptoJobMode
//   2. Modulus Bits
//   3. Divisor Bits
//   4. Public Format
//   5. Public Type
//   6. Private Format
//   7. Private Type
//   8. Cipher
//   9. Passphrase
Maybe<bool> DsaKeyGenTraits::AdditionalConfig(
    CryptoJobMode mode,
    const FunctionCallbackInfo<Value>& args,
    unsigned int* offset,
    DsaKeyPairGenConfig* params) {
  Environment* env = Environment::GetCurrent(args);
  CHECK(args[*offset]->IsUint32());  // modulus bits
  CHECK(args[*offset + 1]->IsInt32());  // divisor bits

  params->params.modulus_bits = args[*offset].As<Uint32>()->Value();
  params->params.divisor_bits = args[*offset + 1].As<Int32>()->Value();
  if (params->params.divisor_bits < -1) {
    THROW_ERR_OUT_OF_RANGE(env, "invalid value for divisor_bits");
    return Nothing<bool>();
  }

  *offset += 2;

  return Just(true);
}

Maybe<bool> DSAKeyExportTraits::AdditionalConfig(
    const FunctionCallbackInfo<Value>& args,
    unsigned int offset,
    DSAKeyExportConfig* params) {
  return Just(true);
}

WebCryptoKeyExportStatus DSAKeyExportTraits::DoExport(
    std::shared_ptr<KeyObjectData> key_data,
    WebCryptoKeyFormat format,
    const DSAKeyExportConfig& params,
    ByteSource* out) {
  CHECK_NE(key_data->GetKeyType(), kKeyTypeSecret);

  switch (format) {
    case kWebCryptoKeyFormatRaw:
      // Not supported for RSA keys of either type
      return WebCryptoKeyExportStatus::FAILED;
    case kWebCryptoKeyFormatPKCS8:
      if (key_data->GetKeyType() != kKeyTypePrivate)
        return WebCryptoKeyExportStatus::INVALID_KEY_TYPE;
      return PKEY_PKCS8_Export(key_data.get(), out);
    case kWebCryptoKeyFormatSPKI:
      if (key_data->GetKeyType() != kKeyTypePublic)
        return WebCryptoKeyExportStatus::INVALID_KEY_TYPE;
      return PKEY_SPKI_Export(key_data.get(), out);
    default:
      UNREACHABLE();
  }
}

Maybe<bool> GetDsaKeyDetail(
    Environment* env,
    std::shared_ptr<KeyObjectData> key,
    Local<Object> target) {
  const BIGNUM* p;  // Modulus length
  const BIGNUM* q;  // Divisor length

  ManagedEVPPKey m_pkey = key->GetAsymmetricKey();
  Mutex::ScopedLock lock(*m_pkey.mutex());
  int type = EVP_PKEY_id(m_pkey.get());
  CHECK(type == EVP_PKEY_DSA);

  const DSA* dsa = EVP_PKEY_get0_DSA(m_pkey.get());
  CHECK_NOT_NULL(dsa);

  DSA_get0_pqg(dsa, &p, &q, nullptr);

  size_t modulus_length = BN_num_bytes(p) * CHAR_BIT;
  size_t divisor_length = BN_num_bytes(q) * CHAR_BIT;

  if (target
          ->Set(
              env->context(),
              env->modulus_length_string(),
              Number::New(env->isolate(), static_cast<double>(modulus_length)))
          .IsNothing() ||
      target
          ->Set(
              env->context(),
              env->divisor_length_string(),
              Number::New(env->isolate(), static_cast<double>(divisor_length)))
          .IsNothing()) {
    return Nothing<bool>();
  }

  return Just(true);
}

namespace DSAAlg {
void Initialize(Environment* env, Local<Object> target) {
  DsaKeyPairGenJob::Initialize(env, target);
  DSAKeyExportJob::Initialize(env, target);
}

void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  DsaKeyPairGenJob::RegisterExternalReferences(registry);
  DSAKeyExportJob::RegisterExternalReferences(registry);
}
}  // namespace DSAAlg
}  // namespace crypto
}  // namespace node
