#include <libxml/parser.h>
#include <libxml/tree.h>
#include <stdio.h>
#include <string.h>

int main(void) {
  const char *doc = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><a><b>ok</b></a>";
  xmlDocPtr d = xmlReadMemory(doc, (int)strlen(doc), "smoke.xml", NULL, 0);
  if (!d) {
    fprintf(stderr, "xmlReadMemory failed (UTF-8)\n");
    return 1;
  }
  xmlNodePtr root = xmlDocGetRootElement(d);
  if (!root || xmlStrcmp(root->name, BAD_CAST "a") != 0) {
    xmlFreeDoc(d);
    return 2;
  }
  xmlFreeDoc(d);
  xmlCleanupParser();
  printf("libxml2 smoke: parsed UTF-8 document (--without-iconv)\n");
  return 0;
}
