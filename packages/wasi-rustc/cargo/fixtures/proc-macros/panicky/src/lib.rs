use proc_macro::TokenStream;

#[proc_macro_derive(Boom)]
pub fn boom(_input: TokenStream) -> TokenStream {
    panic!("boom from a derive macro")
}
