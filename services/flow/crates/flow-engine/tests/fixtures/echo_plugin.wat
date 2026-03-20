;; Echo plugin — copies input to output as-is, wrapped in {"data": <input>}
;; Exports: memory, alloc, dealloc, execute
;; Imports: env.host_log, env.host_get_config, env.host_get_data

(module
  (import "env" "host_log" (func $host_log (param i32 i32)))
  (import "env" "host_get_config" (func $host_get_config (result i64)))
  (import "env" "host_get_data" (func $host_get_data (result i64)))

  (memory (export "memory") 1)

  ;; Simple bump allocator
  (global $bump (mut i32) (i32.const 1024))

  (func (export "alloc") (param $size i32) (result i32)
    (local $ptr i32)
    (local.set $ptr (global.get $bump))
    (global.set $bump (i32.add (global.get $bump) (local.get $size)))
    (local.get $ptr)
  )

  (func (export "dealloc") (param $ptr i32) (param $size i32)
    ;; no-op for bump allocator
  )

  ;; execute(input_ptr, input_len) -> packed i64 (ptr << 32 | len)
  ;; Wraps input in {"data": <input>, "logs": [], "error": ""}
  (func (export "execute") (param $ptr i32) (param $len i32) (result i64)
    (local $out_ptr i32)
    (local $out_len i32)
    (local $prefix_len i32)
    (local $suffix_len i32)

    ;; prefix: {"data":
    (i32.const 0)
    (i32.const 8)  ;; length of {"data":
    ;; Store prefix at address 0
    (i32.store8 (i32.const 0) (i32.const 123))  ;; {
    (i32.store8 (i32.const 1) (i32.const 34))   ;; "
    (i32.store8 (i32.const 2) (i32.const 100))  ;; d
    (i32.store8 (i32.const 3) (i32.const 97))   ;; a
    (i32.store8 (i32.const 4) (i32.const 116))  ;; t
    (i32.store8 (i32.const 5) (i32.const 97))   ;; a
    (i32.store8 (i32.const 6) (i32.const 34))   ;; "
    (i32.store8 (i32.const 7) (i32.const 58))   ;; :
    (local.set $prefix_len (i32.const 8))

    ;; suffix: ,"logs":[],"error":""}
    ;; length = 23
    (i32.store8 (i32.const 8) (i32.const 44))   ;; ,
    (i32.store8 (i32.const 9) (i32.const 34))   ;; "
    (i32.store8 (i32.const 10) (i32.const 108))  ;; l
    (i32.store8 (i32.const 11) (i32.const 111))  ;; o
    (i32.store8 (i32.const 12) (i32.const 103))  ;; g
    (i32.store8 (i32.const 13) (i32.const 115))  ;; s
    (i32.store8 (i32.const 14) (i32.const 34))   ;; "
    (i32.store8 (i32.const 15) (i32.const 58))   ;; :
    (i32.store8 (i32.const 16) (i32.const 91))   ;; [
    (i32.store8 (i32.const 17) (i32.const 93))   ;; ]
    (i32.store8 (i32.const 18) (i32.const 44))   ;; ,
    (i32.store8 (i32.const 19) (i32.const 34))   ;; "
    (i32.store8 (i32.const 20) (i32.const 101))  ;; e
    (i32.store8 (i32.const 21) (i32.const 114))  ;; r
    (i32.store8 (i32.const 22) (i32.const 114))  ;; r
    (i32.store8 (i32.const 23) (i32.const 111))  ;; o
    (i32.store8 (i32.const 24) (i32.const 114))  ;; r
    (i32.store8 (i32.const 25) (i32.const 34))   ;; "
    (i32.store8 (i32.const 26) (i32.const 58))   ;; :
    (i32.store8 (i32.const 27) (i32.const 34))   ;; "
    (i32.store8 (i32.const 28) (i32.const 34))   ;; "
    (i32.store8 (i32.const 29) (i32.const 125))  ;; }
    (local.set $suffix_len (i32.const 22))

    ;; Total output length = prefix + input + suffix
    (local.set $out_len (i32.add (i32.add (local.get $prefix_len) (local.get $len)) (local.get $suffix_len)))

    ;; Allocate output buffer
    (local.set $out_ptr (global.get $bump))
    (global.set $bump (i32.add (global.get $bump) (local.get $out_len)))

    ;; Copy prefix
    (memory.copy
      (local.get $out_ptr)
      (i32.const 0)
      (local.get $prefix_len)
    )

    ;; Copy input data
    (memory.copy
      (i32.add (local.get $out_ptr) (local.get $prefix_len))
      (local.get $ptr)
      (local.get $len)
    )

    ;; Copy suffix
    (memory.copy
      (i32.add (i32.add (local.get $out_ptr) (local.get $prefix_len)) (local.get $len))
      (i32.const 8)
      (local.get $suffix_len)
    )

    ;; Return packed ptr|len
    (i64.or
      (i64.shl (i64.extend_i32_u (local.get $out_ptr)) (i64.const 32))
      (i64.extend_i32_u (local.get $out_len))
    )
  )
)
