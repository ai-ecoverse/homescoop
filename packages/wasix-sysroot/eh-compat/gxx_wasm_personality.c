typedef int _Unwind_Reason_Code;

_Unwind_Reason_Code _Unwind_CallPersonality(void *exception_ptr);

_Unwind_Reason_Code __gxx_wasm_personality_v0(void *exception_ptr)
{
	return _Unwind_CallPersonality(exception_ptr);
}
