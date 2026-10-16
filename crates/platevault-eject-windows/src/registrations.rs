// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The registration bookkeeping behind the notice window, free of Win32.
//!
//! A registration holds the volume notices for one root and, while nothing
//! asked to remove the volume, an open handle to that root. Microsoft's
//! protocol for a removal request decides the rest: the handle closes on the
//! request, opens again when the request is refused, and the registration ends
//! once the volume is going or gone.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::hash::Hash;
use std::io;
use std::path::{Path, PathBuf};

use crate::Removal;

/// A device notice Windows sent about one registration's volume.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Notice {
    /// `DBT_DEVICEQUERYREMOVE`: a removal of the volume is requested.
    QueryRemove,
    /// `DBT_DEVICEQUERYREMOVEFAILED`: the requested removal was refused.
    QueryRemoveFailed,
    /// `DBT_DEVICEREMOVEPENDING` or `DBT_DEVICEREMOVECOMPLETE`: the volume is
    /// going or gone.
    Removed,
}

/// The registrations of the given roots, by the id Windows names each one
/// with in its notices.
pub struct Registrations<K, N> {
    entries: HashMap<usize, Entry<K, N>>,
    open: fn(&Path) -> io::Result<File>,
}

struct Entry<K, N> {
    key: K,
    root: PathBuf,
    /// Open unless a requested removal is still undecided.
    handle: Option<File>,
    /// Ends the registration when dropped.
    _notification: N,
}

impl<K: Clone + Eq + Hash, N> Registrations<K, N> {
    /// No registrations yet; `open` opens a root's handle.
    pub fn new(open: fn(&Path) -> io::Result<File>) -> Self {
        Self { entries: HashMap::new(), open }
    }

    /// Register exactly `roots`. A key that left, or now names another root,
    /// loses its registration, even while a removal of its volume is
    /// undecided. Each root without one is opened and given to `register`,
    /// which registers the handle and returns the registration's id and
    /// notification. A root that cannot be opened or registered stays
    /// unregistered until a later call.
    pub fn follow(
        &mut self,
        roots: &HashMap<K, PathBuf>,
        mut register: impl FnMut(&File) -> io::Result<(usize, N)>,
    ) {
        self.entries.retain(|_, entry| roots.get(&entry.key) == Some(&entry.root));
        let registered: HashSet<K> = self.entries.values().map(|entry| entry.key.clone()).collect();
        for (key, root) in roots.iter().filter(|(key, _)| !registered.contains(*key)) {
            let registration = (self.open)(root).and_then(|handle| {
                register(&handle).map(|(id, notification)| (id, handle, notification))
            });
            match registration {
                Ok((id, handle, notification)) => {
                    let entry = Entry {
                        key: key.clone(),
                        root: root.clone(),
                        handle: Some(handle),
                        _notification: notification,
                    };
                    self.entries.insert(id, entry);
                }
                Err(error) => tracing::warn!(
                    root = %root.display(),
                    %error,
                    "removal notices: root not registered"
                ),
            }
        }
    }

    /// Apply a notice about the registration `id` names and return the
    /// removal to report for its key. `None` for an id whose registration
    /// ended, and for a notice that does not change the root's state: a
    /// repeated request, or a refusal while nothing was requested.
    pub fn notice(&mut self, id: usize, notice: Notice) -> Option<(K, Removal)> {
        let entry = self.entries.get_mut(&id)?;
        match notice {
            Notice::QueryRemove => {
                entry.handle.take()?;
                Some((entry.key.clone(), Removal::Requested))
            }
            Notice::QueryRemoveFailed => {
                if entry.handle.is_some() {
                    return None;
                }
                match (self.open)(&entry.root) {
                    Ok(handle) => {
                        entry.handle = Some(handle);
                        Some((entry.key.clone(), Removal::Refused))
                    }
                    Err(error) => {
                        // A registration without its handle would miss the
                        // next request, so it ends; `follow` registers the
                        // root again.
                        tracing::warn!(
                            root = %entry.root.display(),
                            %error,
                            "removal notices: root not reopened after a refused removal"
                        );
                        self.entries.remove(&id).map(|entry| (entry.key, Removal::Refused))
                    }
                }
            }
            Notice::Removed => self.entries.remove(&id).map(|entry| (entry.key, Removal::Removed)),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::*;

    /// Records the id of each registration that ended.
    struct Notification {
        id: usize,
        ended: Rc<RefCell<Vec<usize>>>,
    }

    impl Drop for Notification {
        fn drop(&mut self) {
            self.ended.borrow_mut().push(self.id);
        }
    }

    /// Registrations over plain files standing in for root folders, which
    /// open the same way on every platform.
    struct Harness {
        registrations: Registrations<&'static str, Notification>,
        next: usize,
        ended: Rc<RefCell<Vec<usize>>>,
        dir: tempfile::TempDir,
    }

    impl Harness {
        fn new() -> Self {
            Self {
                registrations: Registrations::new(|root| File::open(root)),
                next: 0,
                ended: Rc::default(),
                dir: tempfile::tempdir().unwrap(),
            }
        }

        /// A root that opens until it is deleted.
        fn root(&self, name: &str) -> PathBuf {
            let root = self.dir.path().join(name);
            std::fs::write(&root, b"").unwrap();
            root
        }

        /// Follow `roots` and return the ids registered for them.
        fn follow(&mut self, roots: &[(&'static str, &Path)]) -> Vec<usize> {
            let roots = roots.iter().map(|(key, root)| (*key, root.to_path_buf())).collect();
            let mut registered = Vec::new();
            let (next, ended) = (&mut self.next, &self.ended);
            self.registrations.follow(&roots, |_| {
                *next += 1;
                registered.push(*next);
                Ok((*next, Notification { id: *next, ended: Rc::clone(ended) }))
            });
            registered
        }

        fn ended(&self) -> Vec<usize> {
            self.ended.borrow().clone()
        }
    }

    /// No registration ids.
    const NONE: [usize; 0] = [];

    #[test]
    fn a_requested_removal_releases_once_and_a_refusal_rearms() {
        let mut harness = Harness::new();
        let root = harness.root("card");
        let [id] = harness.follow(&[("card", &root)])[..] else { panic!("one registration") };

        assert_eq!(
            harness.registrations.notice(id, Notice::QueryRemove),
            Some(("card", Removal::Requested))
        );
        assert_eq!(harness.registrations.notice(id, Notice::QueryRemove), None, "already released");
        assert_eq!(
            harness.registrations.notice(id, Notice::QueryRemoveFailed),
            Some(("card", Removal::Refused))
        );
        assert_eq!(
            harness.registrations.notice(id, Notice::QueryRemoveFailed),
            None,
            "nothing requested"
        );
        assert_eq!(
            harness.registrations.notice(id, Notice::QueryRemove),
            Some(("card", Removal::Requested))
        );
        assert!(harness.ended().is_empty(), "the registration outlives a refused removal");
    }

    #[test]
    fn a_removed_volume_ends_its_registration() {
        let mut harness = Harness::new();
        let root = harness.root("card");
        let [id] = harness.follow(&[("card", &root)])[..] else { panic!("one registration") };

        assert_eq!(
            harness.registrations.notice(id, Notice::QueryRemove),
            Some(("card", Removal::Requested))
        );
        assert_eq!(
            harness.registrations.notice(id, Notice::Removed),
            Some(("card", Removal::Removed))
        );
        assert_eq!(harness.ended(), [id]);
        // `DBT_DEVICEREMOVECOMPLETE` after `DBT_DEVICEREMOVEPENDING`.
        assert_eq!(harness.registrations.notice(id, Notice::Removed), None);
        assert_eq!(harness.registrations.notice(id, Notice::QueryRemove), None);
    }

    #[test]
    fn a_surprise_removal_reports_without_a_request() {
        let mut harness = Harness::new();
        let root = harness.root("card");
        let [id] = harness.follow(&[("card", &root)])[..] else { panic!("one registration") };

        assert_eq!(
            harness.registrations.notice(id, Notice::Removed),
            Some(("card", Removal::Removed))
        );
        assert_eq!(harness.ended(), [id]);
    }

    #[test]
    fn follow_keeps_a_root_whose_removal_is_undecided() {
        let mut harness = Harness::new();
        let root = harness.root("card");
        let [id] = harness.follow(&[("card", &root)])[..] else { panic!("one registration") };
        harness.registrations.notice(id, Notice::QueryRemove);

        // Discovery still counts the released location, so its root stays,
        // and following it opens no handle on the volume being removed.
        assert_eq!(harness.follow(&[("card", &root)]), NONE);
        assert_eq!(harness.ended(), NONE);
        assert_eq!(
            harness.registrations.notice(id, Notice::QueryRemoveFailed),
            Some(("card", Removal::Refused))
        );
    }

    #[test]
    fn follow_ends_removed_and_remapped_roots_and_registers_new_ones() {
        let mut harness = Harness::new();
        let (card, spare, moved) =
            (harness.root("card"), harness.root("spare"), harness.root("moved"));
        let first = harness.follow(&[("card", &card), ("spare", &spare)]);
        assert_eq!(first.len(), 2);

        // `spare` was removed or retired, `card` remapped to another root.
        let [remapped] = harness.follow(&[("card", &moved)])[..] else {
            panic!("one registration")
        };
        let mut ended = harness.ended();
        ended.sort_unstable();
        assert_eq!(ended, first);
        assert_eq!(
            harness.registrations.notice(remapped, Notice::QueryRemove),
            Some(("card", Removal::Requested))
        );
        assert!(first
            .iter()
            .all(|id| harness.registrations.notice(*id, Notice::QueryRemove).is_none()));

        // Offline or no longer counted.
        harness.follow(&[]);
        assert_eq!(harness.ended().len(), 3);
    }

    #[test]
    fn an_unopenable_root_registers_once_it_opens() {
        let mut harness = Harness::new();
        let root = harness.dir.path().join("card");
        assert_eq!(harness.follow(&[("card", &root)]), NONE);

        std::fs::write(&root, b"").unwrap();
        assert_eq!(harness.follow(&[("card", &root)]).len(), 1);
    }

    #[test]
    fn a_refused_removal_that_cannot_reopen_ends_the_registration() {
        let mut harness = Harness::new();
        let root = harness.root("card");
        let [id] = harness.follow(&[("card", &root)])[..] else { panic!("one registration") };
        harness.registrations.notice(id, Notice::QueryRemove);
        std::fs::remove_file(&root).unwrap();

        // Discovery still reattaches; the root registers again once it opens.
        assert_eq!(
            harness.registrations.notice(id, Notice::QueryRemoveFailed),
            Some(("card", Removal::Refused))
        );
        assert_eq!(harness.ended(), [id]);
        std::fs::write(&root, b"").unwrap();
        assert_eq!(harness.follow(&[("card", &root)]).len(), 1);
    }
}
